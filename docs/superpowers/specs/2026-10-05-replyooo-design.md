# Replyooo — Design Spec

**Date:** 2026-10-05
**Status:** Draft for review
**Scope:** v1 of a public SaaS that auto-replies on Instagram and Facebook using keyword-triggered flows.

---

## 1. Summary

Replyooo lets creators and businesses connect Instagram professional accounts and Facebook Pages, then build **automations**: a trigger (comment keyword, DM keyword, story reply, ice breaker, any DM) followed by a linear list of **steps** (send message with buttons, ask a question and save the answer, check follow, delay, tag, condition). Users start from **templates** (comment-to-DM, grow email list, follow-gate, collect phone numbers, etc.) and edit them in a vertical step editor with a live phone preview. Captured emails and phone numbers become **leads** on the contact record.

Billing is subscription-based via Dodo Payments, metered on contacts reached per month.

### 1.1 Decisions made

| Topic | Decision |
|---|---|
| Audience | Public multi-tenant SaaS |
| Reply model | Keyword rules + multi-step flows + templates (ManyChat/LinkDM style) |
| Platforms | Instagram **and** Facebook from day one |
| Editor | **Recipe form** (Pencil design `App — Automation Editor`): trigger → public reply → DM → toggleable boosters (follow gate, ask for email). The form compiles to a `FlowDefinition`; the engine stays generic. Step-list editor (Pencil frame `App — Automation Editor (Step list)`) is a post-v1 "advanced editor". |
| Integrations | Kit (ConvertKit) email sync for captured emails in v1 |
| Design source | Pencil screens exported to `docs/design/` (brand in designs: "replyo") |
| AI | None in v1; step system leaves room for an `ai_reply` step later |
| Stack | TypeScript monorepo — Next.js, Hono worker, Drizzle + Postgres, Redis + BullMQ |
| Auth | Better Auth (Drizzle adapter, self-hosted) |
| Billing | Dodo Payments (merchant of record) |
| Hosting | Self-hosted on Dokploy (Docker services) |

### 1.2 Out of scope for v1

Live inbox / manual replying, broadcasts, visual flow canvas, step-list editor, link click tracking (Clicks/CTR, "follow up if no click"), "welcome new followers" (no Meta webhook exists), link in bio, AI replies, analytics charts beyond basic counts, WhatsApp/TikTok, public API/Zapier, multi-language UI.

---

## 2. Architecture

### 2.1 Services (Dokploy)

| Service | Responsibility |
|---|---|
| `web` (Next.js) | Marketing + legal pages, auth, dashboard, automation editor, Meta OAuth callbacks, Dodo webhooks |
| `worker` (Node + Hono) | `POST/GET /webhooks/meta` ingestion (verify signature, persist, enqueue, 200 fast); BullMQ consumers: `inbound`, `flow`, `outbound`, `maintenance` |
| `postgres` | All persistent data |
| `redis` | BullMQ queues, per-account rate-limit buckets. **AOF persistence enabled.** |

Meta webhooks terminate on the worker so ingestion is unaffected by dashboard deploys.

### 2.2 Monorepo layout (pnpm + Turborepo)

```
apps/
  web/        Next.js App Router, Tailwind, shadcn/ui, TanStack Query
  worker/     Hono server + BullMQ consumers
packages/
  db/         Drizzle schema, migrations, client
  engine/     Pure flow engine: trigger matching + step execution
  meta/       PlatformAdapter interface, InstagramAdapter, FacebookAdapter
  shared/     Zod schemas (flow definition, steps, triggers), templates, constants
```

### 2.3 PlatformAdapter

```ts
interface PlatformAdapter {
  platform: 'instagram' | 'facebook'
  normalizeWebhook(payload: unknown): NormalizedEvent[]
  sendMessage(account, recipientId, message: OutboundMessage): Promise<SendResult>
  sendPrivateReply(account, commentId, message: OutboundMessage): Promise<SendResult>
  replyToComment(account, commentId, text: string): Promise<SendResult>
  getProfile(account, userId): Promise<Profile>
  isFollower?(account, userId): Promise<boolean>        // Instagram only
  setIceBreakers(account, items: IceBreaker[]): Promise<void>
  subscribeWebhooks(account): Promise<void>
  refreshToken(account): Promise<TokenResult>
}
```

Errors are thrown as a typed `MetaError` with `kind: 'retryable' | 'reauth' | 'permanent'`.

### 2.4 Event flow

1. **Ingest** — Meta → worker `/webhooks/meta`. Verify `X-Hub-Signature-256`, insert into `webhook_events` (unique `dedup_key`; duplicates ignored), enqueue `inbound` job, return 200.
2. **Route** (`inbound` consumer) — adapter normalizes to a platform-neutral event: `dm_received`, `comment_created`, `story_reply`, `postback`. Upsert `contacts` (and `last_inbound_at` for DM/postback/story events). Log inbound to `messages`. Routing:
   1. `postback` → the run it references (payload encodes `run_id` + `step_id` + button id). Ice-breaker postbacks (payload `ib:<automation_id>:<item_index>`) start a new run at that item's `startStep`.
   2. Contact has a `waiting` run → resume that run.
   3. Else match triggers in order: `dm_keyword` → `story_reply` → `any_dm`.
   4. `comment_created` → match `comment_keyword`; cancels the contact's existing waiting run, starts a new one.
   - Re-entry cooldown: a contact cannot start the same automation more than once per 24h.
   - Plan limit reached → do not start new runs.
3. **Execute** (`flow` consumer) — load run + version + contact, call `engine.advance(...)`, apply the returned effects in one DB transaction, then enqueue outbound sends / delayed timeout jobs.
4. **Send** (`outbound` consumer) — check 24h window and per-account token bucket, call adapter, update `messages.status`.

### 2.5 Consistency without a transactional queue

Postgres and Redis writes are not atomic. Mitigations:

- `flow_runs.state_version` increments on every transition. Every `flow` job carries the expected `state_version`; mismatches are no-ops.
- Outbound sends are keyed by a pre-inserted `messages.id` (status `queued`); the consumer skips anything not `queued`, so retries never double-send.
- `maintenance` sweeper (every minute) finds `waiting` runs with `wait_until < now()` and enqueues their timeout, and re-enqueues `messages` stuck in `queued` for > 5 minutes.

---

## 3. Data model (Drizzle / Postgres)

All tables have `id` (uuid v7), `created_at`, `updated_at` unless noted.

### 3.1 Tenancy & auth

- Better Auth tables (`user`, `session`, `account`, `verification`).
- `workspaces` — `name`, `owner_user_id`.
- `workspace_members` — `workspace_id`, `user_id`, `role` (`owner` | `admin` | `member`). Unique `(workspace_id, user_id)`.

### 3.2 Connected accounts

- `connected_accounts` — `workspace_id`, `platform` (`instagram` | `facebook`), `external_id` (IG user ID / Page ID), `username`, `display_name`, `avatar_url`, `access_token_enc` (AES-256-GCM, key from `TOKEN_ENCRYPTION_KEY`), `token_expires_at`, `status` (`active` | `reauth_required` | `disconnected`), `connected_by_user_id`.
  - Unique `(platform, external_id)` — an account can belong to one workspace only.
  - Instagram connects via **Instagram API with Instagram Login** (no Facebook Page required).
  - Facebook connects via **Facebook Login for Business** (user picks Pages).

### 3.3 Audience

- `contacts` — `workspace_id`, `connected_account_id`, `platform_user_id` (IGSID/PSID), `username`, `name`, `avatar_url`, `email`, `phone`, `tags text[]`, `fields jsonb`, `last_inbound_at`, `first_seen_at`.
  - Unique `(connected_account_id, platform_user_id)`. GIN index on `tags`.
  - A **lead** is a contact with `email` or `phone` set.

### 3.4 Automations

- `automations` — `workspace_id`, `connected_account_id`, `name`, `status` (`draft` | `active` | `paused`), `trigger_type`, `trigger jsonb` (draft), `steps jsonb` (draft), `current_version_id` (nullable until first publish), `template_key` (nullable).
- `automation_versions` — `automation_id`, `version int`, `trigger jsonb`, `steps jsonb`, `published_at`. Immutable. Unique `(automation_id, version)`.
- Runs bind to a version; editing/republishing never affects in-flight runs.
- `automation_entries` — `automation_id`, `contact_id`, `last_entered_at`. Unique `(automation_id, contact_id)`. Enforces 24h re-entry cooldown.

### 3.5 Execution

- `flow_runs` — `automation_id`, `automation_version_id`, `contact_id`, `connected_account_id`, `status` (`running` | `waiting` | `completed` | `failed` | `expired` | `cancelled`), `current_step_id`, `wait jsonb` (`{ kind: 'reply' | 'delay' | 'postback', expect?, attempts? }`), `wait_until`, `vars jsonb`, `state_version int`, `trigger_ref jsonb` (e.g. `comment_id`, `media_id`), `error text`, `completed_at`.
  - Partial unique index: one row per `contact_id` where `status = 'waiting'`.
  - Index on `(status, wait_until)` for the sweeper.
- `webhook_events` — `platform`, `dedup_key` (unique), `payload jsonb`, `received_at`, `processed_at`, `error`. Retained 30 days.
- `messages` — `contact_id`, `connected_account_id`, `flow_run_id` (nullable), `direction` (`in` | `out`), `kind` (`dm` | `private_reply` | `comment_reply` | `postback` | `story_reply`), `body jsonb`, `external_id`, `comment_id`, `status` (`queued` | `sent` | `failed` | `received`), `error`, `sent_at`.
  - Partial unique index on `comment_id` where `kind = 'private_reply'` — enforces one private reply per comment.
  - Partial unique index on `comment_id` where `kind = 'comment_reply'` — one public reply per comment.

### 3.6 Billing

- `subscriptions` — `workspace_id` (unique), `plan` (`free` | `pro` | `business`), `dodo_customer_id`, `dodo_subscription_id`, `status`, `current_period_end`.
- `usage_counters` — `workspace_id`, `period` (`YYYY-MM`), `contacts_reached int`. Unique `(workspace_id, period)`. A contact counts once per period on first outbound message.
- Plan limits (contacts reached / month, connected accounts, active automations) live in `packages/shared/plans.ts`. Numbers are set at launch, not in this spec.

---

## 4. Triggers, steps, engine

### 4.1 Flow definition (Zod, `packages/shared`)

```ts
type FlowDefinition = {
  trigger: Trigger
  start: StepId
  steps: Record<StepId, Step>
}
```

Each step has either `next?: StepId` or named branches. Missing `next` = end. For `ice_breaker` triggers, each item's `startStep` overrides `start`.

### 4.2 Triggers

| Trigger | IG | FB | Config |
|---|---|---|---|
| `comment_keyword` | ✓ | ✓ | `posts: { mode: 'specific', mediaIds } \| { mode: 'any' } \| { mode: 'next' }`, `keywords[]`, `match: 'contains' \| 'exact'`, `publicReplies?: string[]` (random pick) |
| `dm_keyword` | ✓ | ✓ | `keywords[]`, `match` |
| `any_dm` | ✓ | ✓ | — (fallback) |
| `story_reply` | ✓ | — | `includeReactions: boolean`, `keywords?: string[]` |
| `ice_breaker` | ✓ | ✓ | `items: { question, startStep }[]` (max 4); pushed to Meta on publish |

Keyword matching is case-insensitive and trims whitespace/emoji-adjacent punctuation. If several automations of the same trigger type match, the most recently published wins.

### 4.3 Steps

| Step | Config | Branches |
|---|---|---|
| `send_message` | `text`, `imageUrl?`, `buttons?: ({ type: 'url', label, url } \| { type: 'reply', label, id })[]` (max 3) | one per `reply` button; `next` if no reply buttons |
| `ask` | `question`, `saveTo: 'email' \| 'phone' \| { field: string }`, `validate: 'email' \| 'phone' \| 'text'`, `retryText`, `maxAttempts` (default 2), `timeout` (default 24h) | `answered`, `invalid`, `timeout` |
| `check_follow` | — (Instagram only) | `following`, `not_following` |
| `delay` | `duration` (1 min – 7 days) | `next` |
| `tag` | `add?: string[]`, `remove?: string[]` | `next` |
| `condition` | `{ has: 'email' \| 'phone' \| { tag } \| { field } }` | `yes`, `no` |

Message text supports variables: `{{first_name}}`, `{{display_name}}` (first name, else the username), `{{username}}`, `{{email}}`, `{{fields.x}}`. Public comment replies support `{{display_name}}` and `{{username}}` only, since a commenter has not given an email or phone yet.

### 4.4 Validation rules (editor + server on publish)

1. Flow graph is acyclic **except** loops that pass through a step that waits (e.g. follow-gate "I followed ✓" button) — a step budget still caps execution.
2. `comment_keyword` flows: the first step must be `send_message` with ≥ 1 `reply` button (Meta allows exactly one private reply until the user responds).
3. `check_follow` and `story_reply` are rejected on Facebook accounts.
4. All branch targets exist; no orphan steps; button/label length limits per Meta.
5. `comment_keyword` with `mode: 'specific'` must have ≥ 1 media ID.

### 4.5 Engine

```ts
advance(input: {
  run: FlowRunState
  version: FlowDefinition
  contact: ContactState
  event: NormalizedEvent | TimeoutEvent | StartEvent
  now: Date
}): { next: FlowRunState; effects: Effect[] }

type Effect =
  | { type: 'send'; message: OutboundMessage }
  | { type: 'privateReply'; commentId: string; message: OutboundMessage }
  | { type: 'commentReply'; commentId: string; text: string }
  | { type: 'checkFollow' }                 // worker resolves, re-enters engine with result
  | { type: 'scheduleTimeout'; at: Date }
  | { type: 'updateContact'; patch: ContactPatch }
  | { type: 'incrementUsage' }
```

- Pure: no I/O, deterministic given inputs (random public-reply pick takes a seeded RNG from the input).
- Executes steps until it hits a wait (`reply`, `postback`, `delay`, `checkFollow`) or the end.
- Hard cap: 50 steps per `advance` call → run `failed` with `step_budget_exceeded`.

### 4.6 Templates (v1)

Defined in `packages/shared/templates/*.ts` as typed `FlowDefinition`s with metadata (`key`, `title`, `description`, `category`, `platforms`, `isNew`).

| Template | Category | Platforms |
|---|---|---|
| Comment → DM a link | Sell products, Recommended | IG, FB |
| Respond to DMs by keyword | Set up your inbox | IG, FB |
| Conversation starters | Set up your inbox | IG, FB |
| Reply to story reactions & replies | Engage with audience | IG |
| Grow followers from comments (follow-gate) | Grow followers | IG |
| Grow your email list | Collect leads | IG, FB |
| Collect phone numbers | Collect leads | IG, FB |

Each template has an engine test that runs it end to end.

---

## 5. Dashboard & onboarding

### 5.1 Onboarding

1. Sign up (email/password or Google via Better Auth) → workspace auto-created → `free` subscription row.
2. Connect account: choose Instagram or Facebook Page → OAuth → store encrypted token, subscribe webhooks. Instagram: reject non-professional accounts with a how-to-switch guide.
3. Template picker opens for the first automation.

### 5.2 Screens

- **Home** — account switcher, contacts reached this month, leads captured, top automations, usage meter + upgrade CTA.
- **Automations** — list with status toggle, trigger summary, runs/completion %; "+ New" opens template picker (search + categories).
- **Automation editor** — left: vertical trigger card + step cards with indented branches, "+" insert between steps, step settings panel; right: phone preview with tabs per trigger (comment: Post / Comments / DM; story reply: Story / DM; otherwise DM only), showing the chosen post or story thumbnail and tappable conversation starters; top: name, draft/live, Publish (runs validation, shows errors inline).
- **Contacts** — table, search, filters (tag, has email, has phone), detail drawer (fields, tags, message timeline, run history), CSV export.
- **Settings** — connected accounts (reconnect/disconnect), members (invite by email), billing (plan, usage, Dodo customer portal link), data deletion (delete workspace).
- **Public** — landing, pricing, privacy policy, terms, data-deletion instructions.

### 5.3 Web endpoints

- `GET /api/meta/oauth/{instagram|facebook}/start`, `/callback`
- `POST /api/meta/deauthorize`, `POST /api/meta/data-deletion` (Meta-required callbacks, signed-request verified)
- `POST /api/webhooks/dodo` (Standard Webhooks signature verification → upsert `subscriptions`)
- Dashboard mutations via server actions; reads via route handlers + TanStack Query.

### 5.4 Editor state

The editor edits the same Zod-validated `FlowDefinition` the engine executes. Draft saves to `automations.trigger/steps`; Publish validates and writes a new `automation_versions` row, sets `current_version_id`, sets status `active`, and (for ice breakers) calls `setIceBreakers`.

---

## 6. Error handling

| Failure | Behavior |
|---|---|
| Duplicate webhook | `webhook_events.dedup_key` unique → ignored |
| Worker crash mid-job | BullMQ retry; `state_version` + `messages.id` idempotency prevent double-advance / double-send |
| Lost delayed job | Minute sweeper on `(status, wait_until)` |
| Meta 429 / 5xx | `retryable` → exponential backoff, max 5 attempts → run `failed` |
| Token expired/revoked | `reauth` → account `reauth_required`, its automations stop starting runs, dashboard banner + email |
| User blocked / window closed / invalid recipient | `permanent` → message `failed`, run `failed`/`expired`, no retry |
| 24h window closed before send | Outbound refuses, run `expired` |
| Plan limit reached | No new runs; in-flight runs finish; upgrade prompt |
| Invalid flow | Publish blocked client- and server-side |

Token refresh: daily `maintenance` cron refreshes Instagram long-lived tokens expiring within 10 days.

Observability: pino structured logs, Sentry for both apps, bull-board (admin-only route on worker), per-run timeline visible to users in Contacts → run history.

---

## 7. Meta App Review readiness

Runs in parallel with development.

- **Instagram permissions:** `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`.
- **Facebook permissions:** `pages_show_list`, `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `pages_manage_engagement`.
- **Prerequisites:** Business Verification (start immediately), privacy policy, terms, data-deletion callback, app icon, screencast per permission demonstrating the real feature.
- Until approved, the app runs in development mode: only accounts with a role on the Meta app can connect. Sufficient for building and internal testing.

---

## 8. Testing

- **Engine (Vitest)** — majority of tests. Every template end to end with fake events: happy path, invalid answers + retries, timeout, follow-gate not-following → following, re-entry cooldown, comment flow without reply button rejected by validation, step budget.
- **Validation (Vitest)** — each rule in §4.4.
- **Adapters (Vitest)** — webhook normalization and error classification against recorded Meta payloads/responses (fixtures).
- **Worker integration** — Postgres + Redis via Docker (testcontainers); Meta HTTP mocked (msw). Webhook in → correct `messages` queued, run state correct, duplicate webhook ignored.
- **Manual E2E** — real IG test account + FB test Page in development mode before each release.

---

## 9. Deployment (Dokploy)

- Dockerfiles for `web` and `worker` (multi-stage, pnpm `--filter` builds).
- Dokploy services: `web`, `worker`, Postgres, Redis (AOF on). Domains: `app.` → web, `hooks.` → worker.
- Migrations run as a one-off `drizzle-kit migrate` step before `web`/`worker` start.
- Env: `DATABASE_URL`, `REDIS_URL`, `TOKEN_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, `META_APP_ID/SECRET`, `INSTAGRAM_APP_ID/SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `DODO_API_KEY`, `DODO_WEBHOOK_SECRET`, `SENTRY_DSN`.
- Backups: Dokploy scheduled Postgres backups.

---

## 10. Build order (input for the implementation plan)

1. Monorepo scaffold, `db` schema + migrations, Docker Compose for local dev.
2. `shared` Zod schemas + validation + templates; `engine` with full test suite (no Meta needed).
3. `meta` adapters (Instagram, Facebook) with fixture tests.
4. Worker: webhook ingestion, inbound router, flow + outbound consumers, sweeper, token refresh.
5. Web: auth, workspaces, OAuth connect, automations list, template picker, editor, publish.
6. Contacts screen + CSV export, Home stats.
7. Dodo billing + plan limits + usage meter.
8. Public/legal pages, Meta deauthorize/data-deletion callbacks.
9. Dokploy deployment, Sentry, bull-board.
10. App Review submission.
