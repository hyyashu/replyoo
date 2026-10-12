# Link click tracking: Design

Date: 2026-10-13. Status: drafted, awaiting review.

Why this one: Reachlee gives click tracking to every plan and we have none in automation DMs (only on the bio page). See [../../competitors/reachlee.md](../../competitors/reachlee.md). It also unlocks per-automation analytics and a later "follow up if no click".

## 1. Goal and scope

When an automation sends a DM with link buttons, record when the person taps a link. Show clicks per automation and per link, on every plan.

**In scope (v1)**
- Count taps on `url` buttons in DMs and private replies that belong to a flow run.
- Numbers only: recipients, unique clickers, click-through rate (CTR), a 14-day trend per link.
- Automations list column, the live-stats bar in the editor, and a "Link clicks" section in the editor.

**Out of scope (v1)**
- URLs typed inside message text (only link buttons are tracked).
- "Who clicked" on the contact drawer, filtering contacts by click, "follow up if no click".
- Back-filling DMs already sent, custom link domains, plan gating, bio links (already tracked).

**Success criteria**
- A DM link button the recipient taps opens the real destination, and the click appears in the numbers.
- Bots and link scanners are not counted.
- A tracking failure never blocks or alters a DM: the original URL is sent instead.
- Links already sitting in people's DMs keep working after the automation, message or contact is deleted.

## 2. How it works

```
worker send()                         web GET /l/<code>
  url button ──insert tracked_links──►  look up code
  button.url = APP_URL/l/<code>         bot? skip count   human? insert link_clicks
  send DM via Meta                      302 → real destination
```

## 3. Data (`packages/db`, one migration)

**`tracked_links`**: one row per link button per sent message.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | primary key (`id()` helper) |
| `code` | text | 8 random base62 characters, unique; the public part of the URL |
| `message_id` | uuid null | references `messages`, `ON DELETE SET NULL` |
| `position` | int | button index inside the message |
| `url` | text | the real destination, frozen at send time |
| `contact_id` | uuid null | references `contacts`, `ON DELETE SET NULL` |
| `automation_id` | uuid null | references `automations`, `ON DELETE SET NULL` |
| `created_at` | timestamptz | default now |

- Unique `(message_id, position)`: a retried send reuses the same row and code.
- Index `(automation_id, created_at)` for stats.
- Every foreign key is `SET NULL` on purpose: deleting an automation, message or contact must not break a link already sent. Clicks then lose attribution, which also suits data-deletion requests.

**`link_clicks`**: `id`, `link_id` (references `tracked_links`, `ON DELETE CASCADE`), `created_at`. Index `(link_id, created_at)`.

**Stats** (window = the existing `STATS_WINDOW_DAYS` = 30; the 14-day trend uses its own range)
- Recipients: distinct `contact_id` over `tracked_links` whose message has `status = 'sent'`, by `created_at` in the window.
- Clickers: distinct `contact_id` among those recipients' links that have at least one `link_clicks` row (links are counted by creation date, clicks at any time), so clickers never exceed recipients.
- CTR = clickers / recipients (shown as "—" when recipients is 0).
- Per link: grouped by `url` within the automation (labels can change, destinations identify the link): recipients, clickers, clicks, CTR.

## 4. Worker (`apps/worker/src/outbound.ts`)

In `send()`, for message kinds `dm` and `private_reply` with a `flowRunId`, before `toSendable`:
1. Collect the `url` buttons of the message body with their index.
2. Look up the run's `automation_id` (one query) and insert a `tracked_links` row per button with `ON CONFLICT (message_id, position) DO NOTHING`, then read back the codes.
3. Pass buttons to `toSendable` with `url = ${deps.appUrl}/l/${code}`; the label is unchanged.

Rules:
- Code generation uses `crypto.randomBytes`; a unique-violation on `code` retries with a new code (a few attempts).
- If anything in step 2 fails, log a warning and send the original URLs. Never fail the DM because of tracking.
- Comment replies, images and postback buttons are untouched.
- `toSendable` stays pure; the rewrite happens in a small helper (`trackLinks(deps, message)`) so it can be unit tested.

## 5. Web redirect (`apps/web/src/app/l/[code]/route.ts`)

`GET` only (a `HEAD` request redirects without counting).
1. Code must match `^[A-Za-z0-9]{8}$`, else 404 (no database hit).
2. Look the code up; unknown code gives 404.
3. Re-check the destination with `isSafeHttpUrl`; refuse (404) if unsafe.
4. If the user agent is a bot (move `isBotUserAgent` from `lib/bio.ts` to a shared helper and reuse it), skip counting. Otherwise insert a `link_clicks` row, ignoring any error so a failed count never stops the visitor.
5. `302` to the destination with `Cache-Control: no-store`.

The route is public: the proxy only guards an explicit list of paths and `/l/` is not on it. Add `/l/` to the `disallow` list in `robots.ts`.

## 6. UI (`apps/web`)

- `AutomationStats` gains `clickers` and `recipients` (so `ctr` can be derived), filled by the existing `automationStats` query (one more grouped query).
- **Automations list** (`automations-table.tsx`): a "Click rate" column next to "Completed", "—" for non-live automations or when there are no recipients; the mobile summary line adds clickers.
- **Editor live-stats bar** (`editor.tsx`, the "Last 30 days" bar): add `link clickers` and `click rate` metrics.
- **"Link clicks" section** in the editor (live automations that have sent a link): per destination, recipients, clickers, clicks, CTR, plus a 14-day bar chart loaded lazily by a server action (same pattern as `getBioBlockDaily` and `BlockInsights` in `bio/stats.tsx`).
- No plan gating, so Free plans see it too.

## 7. Testing

- **db** (Testcontainers Postgres): migration applies; stats query counts recipients, clickers and CTR correctly; per-link grouping by URL; `SET NULL` keeps rows when an automation or contact is deleted; `(message_id, position)` uniqueness.
- **worker**: URL buttons are rewritten for `dm` and `private_reply`; postback buttons, images and comment replies are untouched; a retried message reuses its codes; an insert failure falls back to the raw URL and the message is still sent; message without a flow run is not rewritten.
- **web**: route returns 404 for a bad format and an unknown code; a human request records a click and redirects; a bot request redirects without recording; an unsafe destination gives 404; stats helpers (CTR rounding, empty states).
- **Live check** (add to the pending real-world tests): send a real DM from a connected account and tap the button on a phone. Confirm the click lands, and that Instagram's in-app browser or link scanner does not pre-fetch the link and inflate counts.

## 8. Risks and open points

- **Link prefetch** by Meta or the in-app browser could be counted as a click. The bot filter covers known user agents; the live check shows whether more is needed.
- **Table growth:** one `tracked_links` row per link per DM. No retention policy in v1; revisit pruning (for example rows older than a year with no clicks) if the table gets large.
- **Link shows our domain** instead of the destination. Same trade-off Reachlee makes; users should know before relying on it. A one-line note in the "Link clicks" section says people see a short replyooo link.
- **Counts exclude old DMs:** the numbers start from the release; say so in the empty state.
