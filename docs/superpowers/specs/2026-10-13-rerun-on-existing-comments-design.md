# Re-run on existing comments: Design

Date: 2026-10-13. Status: approved, implemented and merged to `main`; not yet deployed.

Why this one: Reachlee offers "re-run on old posts" on its Pro plan and we have nothing like it. See [../../competitors/reachlee.md](../../competitors/reachlee.md). Today an automation only reacts to comments that reach us through the webhook after it goes live, so comments made earlier, or missed during downtime or a reauth gap, are never answered.

## 1. Goal and scope

Add a "Run on existing comments" action to a comment automation. It fetches the comments already on the automation's target post(s) and runs them through the automation, as if the webhook had delivered them live. It covers two uses: catching up when an automation is published after people commented, and recovering comments we missed.

**In scope (v1)**
- Comment-keyword automations on Instagram and Facebook, on every plan.
- A window of 24 hours, 3 days or 7 days. The maximum is 7 because Meta only allows a private reply within 7 days of the comment.
- A preview before running: comments found, already handled, outside the window, matching, with the number that would start a run.
- A summary after the run (comments found, queued for a reply, already handled, no match).

**Out of scope (v1)**
- Story-reply, DM-keyword and any-DM automations (stories are not comments).
- Comments older than 7 days (public reply only is possible, but it is not what people expect from "re-run").
- Replies to comments (the Graph API list returns top-level comments only).
- Scheduling a re-run, or re-running automatically.
- Re-running people who already went through the automation.

**Success criteria**
- A comment made before the automation was published, still inside the window, gets the same public reply and DM a live comment would.
- Running twice never sends twice. A comment that already has a run or a reply is skipped.
- Plan limits, rate limits and the 24-hour re-entry cooldown apply exactly as for live comments.
- Other automations never fire because of a re-run.

## 2. How it works

```
web: dialog ──preview──► adapter.listComments (live, capped) + DB check ──► counts
web: confirm ──insert backfill_runs (queued)
worker sweep (every 60s) ──► picks up queued run
  for each target post: page comments newest-first until older than the window
  for each new comment: insert webhook_events (dedup_key backfill:<run>:<comment>)
                        ──► the existing inbound job ──► routing ──► flow ──► outbound
  finish: write counts, status = done
```

The web app never talks to Redis or the worker, so the hand-off is a database row, the same way the rest of the system works. The existing sweep already re-queues unprocessed `webhook_events` after 2 minutes, so a crash mid-run recovers on its own.

## 3. Data (`packages/db`, one migration)

**`backfill_runs`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | primary key (`id()` helper) |
| `automation_id` | uuid | references `automations`, `ON DELETE CASCADE` |
| `connected_account_id` | uuid | references `connected_accounts`, `ON DELETE CASCADE` |
| `window_hours` | int | 24, 72 or 168 |
| `status` | enum | `queued`, `running`, `done`, `failed` |
| `found` | int | comments seen inside the window |
| `skipped_handled` | int | already had a run or a reply |
| `skipped_no_match` | int | keywords or post did not match |
| `enqueued` | int | events handed to the inbound job |
| `capped` | bool | stopped at the 500-comment cap |
| `error` | text null | failure reason |
| `created_at`, `started_at`, `finished_at` | timestamptz | `started_at` / `finished_at` nullable |

- Partial unique index on `(automation_id)` where `status in ('queued','running')`: one active run per automation.
- Index `(automation_id, created_at)` for the latest-run lookup.
- The summary after the run shows these stored counts. What happens to each queued comment afterwards (a run starts, the contact is on cooldown, the plan limit is reached) is decided by the normal inbound code and is not counted here.

No change to `webhook_events`: backfill events use the existing table with their own `dedup_key`.

## 4. Meta adapters (`packages/meta`)

New method on `PlatformAdapter`:

```ts
interface CommentItem {
  id: string
  mediaId: string
  text: string
  createdAt: Date
  authorId: string        // IGSID / PSID
  authorUsername: string | null
  authorName: string | null
}

listComments(account, mediaId, opts?: { cursor?: string }): Promise<{ items: CommentItem[]; next?: string }>
```

- **Instagram:** `GET /{media-id}/comments?fields=id,text,timestamp,username,from{id,username}&limit=50`. Results are newest first and cannot be filtered by time, so the caller stops paging when it passes the cutoff. Top-level comments only.
- **Facebook:** `GET /{post-id}/comments?fields=id,message,created_time,from{id,name}&order=reverse_chronological&filter=toplevel&limit=50`. Confirmed against Meta's docs on 2026-10-13: `/{post-id}/comments` accepts `filter`, `order` and `since`; ordering may be ranked regardless of `order`, so the gather helper passes `since` and filters by time itself.
- Comments with no `from.id` (author hidden or restricted) are dropped and counted under `found` only.
- A new helper `collectComments(adapter, account, mediaId, { since, max })` in `packages/meta` handles paging, the cutoff and the cap, and is shared by the preview and the worker.

## 5. Classification (`packages/engine`)

A pure function `classifyComments(comments, candidate, handledCommentIds, now)` buckets each comment as `handled`, `too_old` (over 7 days, defensive), `no_match` (reuses `matchAutomation` so keyword and post rules stay in one place) or `eligible`. The preview and the worker both call it, so the dialog's numbers equal what the run will do.

`handledCommentIds` comes from the database: any comment id that already has a `flow_runs.comment_id` for any automation, or an outbound `private_reply` / `comment_reply` message. This also respects the existing unique indexes `messages_one_private_reply_per_comment` and `messages_one_comment_reply_per_comment`, and Meta's one-private-reply-per-comment rule.

## 6. Worker (`apps/worker`)

- `sweep` picks up `queued` runs (oldest first, limit per tick) and marks them `running`.
- `handleBackfill(deps, runId)`:
  1. Load the automation and its current version. Stop with `failed` if it is no longer active or the account is not `active`.
  2. Resolve target posts from the trigger: `specific` uses its media ids; `next` uses `pinnedMediaId` (a `next` automation with no pin yet has no target and the action is disabled); `any` scans the account's 24 most recent posts (`adapter.listMedia`), because a recent comment can be on an older post.
  3. Collect comments per post with `collectComments`, up to a total of 500 across all posts, newest-first within each post.
  4. Classify, then process eligible comments **oldest first**.
  5. For each, insert a `comment_created` event into `webhook_events` with `dedup_key = backfill:<run>:<comment>` and call `deps.jobs.inbound`.
  6. Write the counts and set `done`.
- The event carries a new optional `restrictToAutomationId`. `processEvent` then builds its candidate list from that one automation only, so no other automation can match an old comment. Normal webhook events are unchanged.
- `occurredAt` on the event is the comment's real timestamp.
- Everything after the inbound job (contact upsert, `mayStartRun` plan check, 24-hour re-entry cooldown, flow, outbound, rate limiter) is the existing code.
- Errors from Meta use the existing handling: `reauth` flags the account, anything else ends the run as `failed` with a reason. There is no automatic retry; the user runs it again.

## 7. Web (`apps/web`)

- A "Run on existing comments" button on the automation editor (the automations list menu is a possible follow-up), for active `comment_keyword` automations only. Disabled with a reason for `next` mode with no pinned post, and for paused or draft automations.
- A dialog: window picker (24h / 3 days / 7 days), then a preview computed by a server action using `collectComments` and `classifyComments` with the account's decrypted credentials, the same way the post picker does. It shows "42 comments in the window · 30 would get a reply · 12 already handled", marked "500+" when capped. A button runs it.
- Creating the run is a server action that inserts a `queued` row. If one is already queued or running, it returns that one.
- The editor shows the latest run: status, then a summary (replies started, already handled, no match, stopped at limit) once done.
- All strings go through next-intl in both English and Spanish catalogs (`translations:check` must stay green).

## 8. Limits and safety

- Cap of 500 comments per run, set by a constant. The cap applies to the newest comments Meta returns, before they are sorted into handled, no match and eligible, so running again re-reads the same newest 500 and does not reach older ones. A capped run says so ("only the newest 500 were checked"); making a re-run continue past the cap is a possible follow-up.
- One active run per automation (the partial unique index).
- The preview is live Meta traffic, so it is capped the same way and read-only.
- Past the monthly contact limit, new runs do not start (existing `mayStartRun`); comments queued for a contact the plan no longer covers are dropped by the normal plan check and are not counted separately.
- A re-run is idempotent: handled comments are excluded up front, and the unique indexes on `messages` are the backstop.
- Backfill events are not subject to webhook signature checks because they never come from the public endpoint.

## 9. Testing

- `packages/meta`: Instagram and Facebook `listComments` against recorded responses; `collectComments` paging, cutoff and cap.
- `packages/engine`: `classifyComments` for every bucket, including keyword vs catch-all precedence.
- `packages/db`: the migration, the one-active-run index.
- `apps/worker`: end to end with the fake adapter and Testcontainers: eligible comments start runs oldest-first; already handled ones are skipped; a comment inside a different automation's post does not fire it; the cap; a plan-limit stop; running twice sends once; a non-active account fails the run.
- `apps/web`: the preview and run server actions, including permissions (workspace member only) and the disabled states; translations check.
- Manual: a real-phone run on a connected account is added to the pending real-world tests.

## 10. Open items

- Making a capped run continue past the first 500 comments (count only eligible comments toward the cap).
