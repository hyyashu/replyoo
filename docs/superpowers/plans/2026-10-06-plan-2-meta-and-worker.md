# Replyooo Plan 2: Meta Adapters & Worker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the Plan 1 engine to Instagram and Facebook. Build `packages/meta` (webhook normalization, Graph API calls, error classification) and `apps/worker` (webhook ingestion, inbound routing, flow execution, outbound sending, sweeper, token refresh). Everything is tested against real Postgres + Redis (Testcontainers) with Meta's HTTP API mocked (msw). No real Meta account is needed until manual E2E.

**Architecture:** `packages/meta` is a thin, stateless layer: `normalize*Webhook(payload) → NormalizedEvent[]` (pure) and `create*Adapter()` (Graph HTTP calls that throw a typed `MetaError`). `apps/worker` is a Hono server plus four BullMQ queues (`inbound`, `flow`, `outbound`, `maintenance`). Every job handler is a plain async function `handleX(deps, data)` that takes a `Deps` object (db, jobs, adapters, rate limiter, clock), so handlers are tested directly against Postgres with a recording `Jobs` fake and a fake adapter. BullMQ wiring is thin and covered by one end-to-end test.

**Tech Stack:** Plan 1 stack + Hono 4 (`@hono/node-server` 2), BullMQ 6 + ioredis 6, pino 10, msw 3, `@testcontainers/redis`, tsx.

**Spec:** `docs/superpowers/specs/2026-10-05-replyooo-design.md` (§2.3–2.5, §3.5, §6, §8)
**Previous plan:** `docs/superpowers/plans/2026-10-05-plan-1-foundation-and-engine.md` (merged to `main`)

**Roadmap (unchanged):**
- Plan 3: web app (`apps/web`): Better Auth, workspaces, Meta OAuth connect (calls `subscribeWebhooks`), automations list, template picker, recipe editor, publish (calls `setIceBreakers`), contacts.
- Plan 4: Dodo billing + **plan limits** (the start-run check goes in `apps/worker/src/inbound.ts` where a run is created), legal pages + Meta callbacks, Dockerfiles + Dokploy, Sentry, bull-board, App Review.

## Global Constraints

- All Plan 1 constraints still apply (TypeScript strict ESM, `import type`, internal packages export `./src/index.ts`, Postgres 18 `uuidv7()`).
- New package names: `@replyooo/meta`, `@replyooo/worker`.
- Graph API version: one constant `GRAPH_API_VERSION = 'v24.0'` in `packages/meta/src/graph.ts`, overridable via `META_GRAPH_VERSION`. Instagram base URL `https://graph.instagram.com/<version>`; Facebook `https://graph.facebook.com/<version>`. Auth with an `Authorization: Bearer <token>` header.
- Instagram uses **Instagram API with Instagram Login**. `connected_accounts.external_id` is the IG professional account ID (the `user_id` from `/me`, which is also webhook `entry.id`). Facebook `external_id` is the Page ID.
- Meta message limits enforced at publish: button template text ≤ **640** chars. The first message of a comment flow can't have an image (one private reply = one API call). At send time the adapter truncates rendered text: buttons → 640, plain text → 1000.
- Postback payloads: `r:<runId>:<stepId>:<buttonId>` for flow buttons, `ib:<automationId>:<itemIndex>` for ice breakers (`packages/shared/src/postback.ts`).
- Webhooks: `X-Hub-Signature-256` is checked against **both** `META_APP_SECRET` (Facebook) and `INSTAGRAM_APP_SECRET` (Instagram Login). One `webhook_events` row per **normalized event** (dedup key per Meta message/comment id), not per HTTP delivery.
- BullMQ custom job IDs must not contain `:`, so use `-`.
- Ordering: one `advance` call's sends go in **one** outbound job (`messageIds` in order), sent sequentially. A message with an image becomes two `messages` rows (image first, then text/buttons), so every row is exactly one Graph call. This keeps retries idempotent.
- Idempotency: a `messages` row is sent only while `status = 'queued'`. Flow jobs for timeouts and follow results carry `expectedVersion`. A mismatch is a no-op. Reply/postback/start events are guarded by the engine and the run status.
- DM window: `dm` sends need `contacts.last_inbound_at` within 24h. Otherwise the message is `failed` (`window_closed`), the run becomes `expired`, and Meta isn't called. Private replies and comment replies don't check the window.
- Error handling (`MetaError.kind`): `retryable` → throw (BullMQ: 5 attempts, exponential backoff from 2s). On the final attempt it's treated as permanent. `reauth` → account `reauth_required`, message failed, run failed. `permanent` → message failed, rest of the batch `failed` with `skipped`, run failed (or `expired` for `window_closed`).
- Re-entry cooldown (spec §2.4): one start per `(automation, contact)` per 24h, enforced atomically with a conditional upsert on `automation_entries`. Starting a run cancels the contact's current `waiting` run.
- A contact's waiting run takes priority over `any_dm`, but a matching `dm_keyword` or `story_reply` interrupts it. The worker dry-runs `advance` (pure) to decide whether a DM is an answer for the waiting run.
- Usage: the outbound consumer counts a contact once per `YYYY-MM` (UTC) on its first successful send, using `contacts.last_counted_period` + `usage_counters`.
- Sweeper (every minute): timeouts overdue by > 30s, starts lost for > 2 min (`running` at version 0), outbound messages `queued` for > 5 min, webhook events unprocessed for > 2 min (only the last 24h). Daily: refresh Instagram tokens expiring within 10 days, delete `webhook_events` older than 30 days.
- No plan-limit checks, Sentry or bull-board in this plan (Plan 4).

## Review Focus

1. **Meta delivers the same webhook twice** (or one POST holds the same message twice) → one `webhook_events` row, one run, one send. Test: Task 10 `duplicate deliveries are stored once`, Task 16 e2e `duplicate webhook is ignored`.
2. **Outbound job retried after Meta accepted the send** → no second Graph call. Test: Task 14 `skips messages that are no longer queued`.
3. **Stale timeout job** (the run already moved on) → no state change, no sends. Test: Task 13 `timeout with a stale expectedVersion is a no-op`.
4. **DM after the 24h window** (e.g. a 2-day delay step) → no Graph call, message `failed: window_closed`, run `expired`. Test: Task 14 `refuses DMs outside the 24h window`.
5. **Our own public reply comes back as a comment webhook** → ignored (no reply loop). Test: Task 5 `ignores comments made by the account itself`.
6. **User answers an `ask` step while an `any_dm` automation exists** → the answer goes to the waiting run, not a new `any_dm` run. Test: Task 11 `a valid answer resumes the waiting run even when any_dm matches`.
7. **Revoked token (code 190)** → account `reauth_required`, run `failed`, no retries. Test: Task 14 `reauth errors flag the account and fail the run`.

---

## File Structure

```
.env.example                          + Meta / worker variables
packages/
  shared/src/postback.ts              encode/decode postback payloads
  shared/src/validate.ts              + buttons_text_too_long, comment_first_message_image
  db/src/crypto.ts                    AES-256-GCM token encryption
  db/src/schema.ts                    + contacts.last_counted_period, message_kind 'comment'
  db/migrations/0001_*.sql            generated
  meta/
    package.json, tsconfig.json
    src/index.ts                      barrel
    src/types.ts                      NormalizedEvent, SendableMessage, PlatformAdapter, ...
    src/errors.ts                     MetaError, classifyGraphError
    src/graph.ts                      graphRequest (fetch wrapper), GRAPH_API_VERSION
    src/messages.ts                   toGraphMessage
    src/normalize.ts                  normalizeInstagramWebhook, normalizeFacebookWebhook
    src/instagram.ts                  createInstagramAdapter
    src/facebook.ts                   createFacebookAdapter
    test/fixtures.ts                  webhook payloads
    test/*.test.ts
apps/
  worker/
    package.json, tsconfig.json, vitest.config.ts
    src/env.ts                        loadEnv (Zod)
    src/logger.ts                     pino
    src/deps.ts                       Deps, Jobs, RateLimiter, job data types
    src/records.ts                    row ↔ engine state mapping, contact patches, endRun, accounts
    src/webhooks.ts                   verifySignature, ingestWebhook
    src/server.ts                     Hono app
    src/route.ts                      decideRoute (pure)
    src/inbound.ts                    handleInbound
    src/flow.ts                       handleFlowJob, handleFollowCheck
    src/outbound.ts                   handleOutbound, countUsage
    src/rate-limit.ts                 Redis fixed-window limiter
    src/maintenance.ts                sweep, refreshExpiringTokens, pruneWebhookEvents
    src/queues.ts                     BullMQ queues, Jobs impl, workers, schedulers
    src/main.ts                       process entry
    test/global-setup.ts              Postgres + Redis containers, migrations
    test/support.ts                   test deps, RecordingJobs, FakeAdapter, seed helpers
    test/*.test.ts
```

---

### Task 1: Shared: Meta message limits + postback codec

**Files:**
- Create: `packages/shared/src/postback.ts`
- Modify: `packages/shared/src/validate.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/test/postback.test.ts`, `packages/shared/test/validate-meta.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type PostbackPayload =
    | { kind: 'run'; runId: string; stepId: string; buttonId: string }
    | { kind: 'ice_breaker'; automationId: string; itemIndex: number }
  function encodePostback(payload: PostbackPayload): string
  function decodePostback(raw: string): PostbackPayload | null
  const MAX_BUTTON_TEMPLATE_TEXT = 640
  // ValidationCode gains: 'buttons_text_too_long' | 'comment_first_message_image'
  ```

- [ ] **Step 1: Write the failing tests**

`packages/shared/test/postback.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { decodePostback, encodePostback } from '../src'

describe('postback payloads', () => {
  it('round-trips run buttons', () => {
    const payload = { kind: 'run', runId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', stepId: 's1', buttonId: 'send_it' } as const
    const raw = encodePostback(payload)
    expect(raw).toBe('r:0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b:s1:send_it')
    expect(decodePostback(raw)).toEqual(payload)
  })

  it('round-trips ice breakers', () => {
    const payload = { kind: 'ice_breaker', automationId: 'a1', itemIndex: 2 } as const
    expect(encodePostback(payload)).toBe('ib:a1:2')
    expect(decodePostback('ib:a1:2')).toEqual(payload)
  })

  it.each(['', 'hello', 'r:a:b', 'r:a:b:c:d', 'ib:a', 'ib:a:x', 'ib:a:-1', 'ib::1', 'r::s1:b1'])(
    'rejects %j',
    (raw) => {
      expect(decodePostback(raw)).toBeNull()
    },
  )
})
```

`packages/shared/test/validate-meta.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { FlowDefinition, StepOf } from '../src'
import { MAX_BUTTON_TEMPLATE_TEXT, TEMPLATES, validateFlow } from '../src'

const codes = (flow: FlowDefinition) => validateFlow(flow, 'instagram').map((issue) => issue.code)

const commentFlow = (first: StepOf<'send_message'>): FlowDefinition => ({
  trigger: { type: 'comment_keyword', posts: { mode: 'any' }, keywords: ['guide'], match: 'contains' },
  start: 's1',
  steps: { s1: first, s2: { type: 'send_message', text: 'Here is the link' } },
})

const tapButton = [{ type: 'reply' as const, id: 'b1', label: 'Send it', next: 's2' }]

describe('validateFlow: Meta message limits', () => {
  it('rejects button messages longer than the button template allows', () => {
    const flow = commentFlow({
      type: 'send_message',
      text: 'x'.repeat(MAX_BUTTON_TEMPLATE_TEXT + 1),
      buttons: tapButton,
    })
    expect(codes(flow)).toEqual(['buttons_text_too_long'])
  })

  it('accepts button messages at the limit and long plain messages', () => {
    const flow = commentFlow({ type: 'send_message', text: 'x'.repeat(MAX_BUTTON_TEMPLATE_TEXT), buttons: tapButton })
    flow.steps.s2 = { type: 'send_message', text: 'y'.repeat(1000) }
    expect(codes(flow)).toEqual([])
  })

  it('rejects an image on the first message of a comment flow', () => {
    const flow = commentFlow({
      type: 'send_message',
      text: 'Tap below',
      imageUrl: 'https://cdn.example.com/a.jpg',
      buttons: tapButton,
    })
    expect(codes(flow)).toEqual(['comment_first_message_image'])
  })

  it('allows images on later messages', () => {
    const flow = commentFlow({ type: 'send_message', text: 'Tap below', buttons: tapButton })
    flow.steps.s2 = { type: 'send_message', text: 'Here', imageUrl: 'https://cdn.example.com/a.jpg' }
    expect(codes(flow)).toEqual([])
  })

  it('keeps every v1 template valid', () => {
    for (const template of TEMPLATES) {
      for (const platform of template.platforms) {
        expect(validateFlow(template.flow, platform), template.key).toEqual([])
      }
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @replyooo/shared test postback validate-meta`
Expected: FAIL. `encodePostback` and `MAX_BUTTON_TEMPLATE_TEXT` aren't exported yet.

- [ ] **Step 3: Implement**

`packages/shared/src/postback.ts`:
```ts
export type PostbackPayload =
  | { kind: 'run'; runId: string; stepId: string; buttonId: string }
  | { kind: 'ice_breaker'; automationId: string; itemIndex: number }

export function encodePostback(payload: PostbackPayload): string {
  return payload.kind === 'run'
    ? `r:${payload.runId}:${payload.stepId}:${payload.buttonId}`
    : `ib:${payload.automationId}:${payload.itemIndex}`
}

export function decodePostback(raw: string): PostbackPayload | null {
  const parts = raw.split(':')
  if (parts[0] === 'r' && parts.length === 4) {
    const [, runId, stepId, buttonId] = parts
    if (runId && stepId && buttonId) return { kind: 'run', runId, stepId, buttonId }
    return null
  }
  if (parts[0] === 'ib' && parts.length === 3) {
    const [, automationId, index] = parts
    const itemIndex = Number(index)
    if (automationId && index && /^\d+$/.test(index)) return { kind: 'ice_breaker', automationId, itemIndex }
  }
  return null
}
```

In `packages/shared/src/validate.ts`:

1. Add the codes to `ValidationCode`:
```ts
  | 'buttons_text_too_long'
  | 'comment_first_message_image'
```
2. Add the constant below the `ValidationIssue` interface:
```ts
/** Meta's button template caps the text above the buttons at 640 characters. */
export const MAX_BUTTON_TEMPLATE_TEXT = 640
```
3. Inside the `for (const [stepId, step] of Object.entries(steps))` loop, after the `next_with_reply_buttons` check:
```ts
    if (
      step.type === 'send_message' &&
      (step.buttons ?? []).length > 0 &&
      step.text.length > MAX_BUTTON_TEMPLATE_TEXT
    ) {
      issues.push({
        code: 'buttons_text_too_long',
        stepId,
        message: `Messages with buttons can be at most ${MAX_BUTTON_TEMPLATE_TEXT} characters`,
      })
    }
```
4. Inside `if (trigger.type === 'comment_keyword') { ... }`, after the `comment_needs_reply_button` check:
```ts
    if (first?.type === 'send_message' && first.imageUrl) {
      issues.push({
        code: 'comment_first_message_image',
        stepId: flow.start,
        message: 'The first message after a comment is a single private reply and cannot include an image',
      })
    }
```

Append to `packages/shared/src/index.ts`:
```ts
export * from './postback'
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @replyooo/shared test && pnpm --filter @replyooo/shared typecheck`
Expected: PASS (all old and new tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add postback codec and Meta message limits to validation"
```

---

### Task 2: DB: token encryption + usage-counting migration

**Files:**
- Create: `packages/db/src/crypto.ts`, `packages/db/migrations/0001_*.sql` (generated)
- Modify: `packages/db/src/schema.ts`, `packages/db/src/client.ts`, `packages/db/src/index.ts`
- Test: `packages/db/test/crypto.test.ts`, `packages/db/test/schema.test.ts`

**Interfaces:**
- Produces:
  ```ts
  function parseEncryptionKey(base64: string): Buffer          // must decode to 32 bytes
  function encryptToken(plain: string, key: Buffer): string     // "v1:<iv>:<tag>:<ciphertext>" (base64 parts)
  function decryptToken(value: string, key: Buffer): string
  type Tx                                                         // drizzle transaction handle
  // schema: contacts.lastCountedPeriod (text, nullable); messageKindEnum gains 'comment'
  ```

- [ ] **Step 1: Write the failing tests**

`packages/db/test/crypto.test.ts`:
```ts
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptToken, encryptToken, parseEncryptionKey } from '../src/crypto'

const key = randomBytes(32)

describe('token encryption', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const a = encryptToken('IGAAT-secret-token', key)
    const b = encryptToken('IGAAT-secret-token', key)
    expect(a).not.toBe(b)
    expect(a.startsWith('v1:')).toBe(true)
    expect(a).not.toContain('IGAAT')
    expect(decryptToken(a, key)).toBe('IGAAT-secret-token')
  })

  it('rejects tampered ciphertext and the wrong key', () => {
    const value = encryptToken('token', key)
    const [v, iv, tag, ct] = value.split(':')
    const tampered = [v, iv, tag, Buffer.from('nope').toString('base64')].join(':')
    expect(() => decryptToken(tampered, key)).toThrow()
    expect(() => decryptToken(value, randomBytes(32))).toThrow()
    expect(ct).toBeTruthy()
  })

  it('rejects unknown formats', () => {
    expect(() => decryptToken('plain-token', key)).toThrow(/format/)
  })

  it('parses a base64 32-byte key and rejects others', () => {
    expect(parseEncryptionKey(key.toString('base64')).equals(key)).toBe(true)
    expect(() => parseEncryptionKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/)
  })
})
```

Append to the `describe` in `packages/db/test/schema.test.ts` (it reuses that file's `seed()` and `db`):
```ts
  it('stores the usage period on contacts and allows comment messages', async () => {
    const { account, contact } = await seed()
    await db.update(contacts).set({ lastCountedPeriod: '2026-10' }).where(eq(contacts.id, contact.id))
    const [row] = await db.select().from(contacts).where(eq(contacts.id, contact.id))
    expect(row?.lastCountedPeriod).toBe('2026-10')

    await db.insert(messages).values({
      contactId: contact.id,
      connectedAccountId: account.id,
      direction: 'in',
      kind: 'comment',
      body: { text: 'GUIDE' },
      commentId: 'c1',
      status: 'received',
    })
  })
```
Add `import { eq } from 'drizzle-orm'` to the test file's imports (`contacts` and `messages` are already imported from `../src`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @replyooo/db test`
Expected: FAIL. `../src/crypto` doesn't exist, and `lastCountedPeriod` isn't a column yet.

- [ ] **Step 3: Implement**

`packages/db/src/crypto.ts`:
```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const VERSION = 'v1'

export function parseEncryptionKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64')
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded')
  return key
}

export function encryptToken(plain: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':')
}

export function decryptToken(value: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = value.split(':')
  if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error('Unrecognized encrypted token format')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8')
}
```

In `packages/db/src/schema.ts`:
- Add `'comment'` to the end of `messageKindEnum`'s values:
  ```ts
  export const messageKindEnum = pgEnum('message_kind', [
    'dm',
    'private_reply',
    'comment_reply',
    'postback',
    'story_reply',
    'comment',
  ])
  ```
- In `contacts`, after `lastInboundAt`:
  ```ts
    /** `YYYY-MM` of the last period this contact was counted in usage_counters. */
    lastCountedPeriod: text('last_counted_period'),
  ```

Append to `packages/db/src/client.ts`:
```ts
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
```

Replace `packages/db/src/index.ts` with:
```ts
export * from './schema'
export * from './crypto'
export { createDb } from './client'
export type { Db, Tx } from './client'
```

Generate the migration:

Run: `pnpm --filter @replyooo/db exec drizzle-kit generate --name usage_counting`
Expected: `packages/db/migrations/0001_usage_counting.sql` containing `ALTER TYPE "public"."message_kind" ADD VALUE 'comment';` and `ALTER TABLE "contacts" ADD COLUMN "last_counted_period" text;`. Read the file. It must contain no other changes.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @replyooo/db test && pnpm --filter @replyooo/db typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat(db): add token encryption, usage period column and comment message kind"
```

---
### Task 3: Meta package scaffold: types, errors, Graph client

**Files:**
- Create: `packages/meta/package.json`, `packages/meta/tsconfig.json`, `packages/meta/src/index.ts`, `packages/meta/src/types.ts`, `packages/meta/src/errors.ts`, `packages/meta/src/graph.ts`
- Test: `packages/meta/test/errors.test.ts`, `packages/meta/test/graph.test.ts`

**Interfaces:**
- Consumes: `Platform` from `@replyooo/shared`.
- Produces:
  ```ts
  interface AccountCredentials { externalId: string; accessToken: string }
  type SendableButton = { type: 'url'; label: string; url: string } | { type: 'postback'; label: string; payload: string }
  type SendableMessage = { kind: 'text'; text: string; buttons?: SendableButton[] } | { kind: 'image'; url: string }
  interface SendResult { messageId: string | null }
  interface Profile { name: string | null; username: string | null; avatarUrl: string | null }
  interface TokenResult { accessToken: string; expiresAt: Date | null }
  interface IceBreaker { question: string; payload: string }
  type NormalizedEvent = dm_received | story_reply | postback | comment_created   // see types.ts; JSON-safe (occurredAt is an ISO string)
  interface PlatformAdapter { ... }                                                // see types.ts
  type MetaErrorKind = 'retryable' | 'reauth' | 'permanent'
  type MetaFailureReason = 'window_closed' | 'user_unavailable' | 'rate_limited' | 'token_invalid' | 'permission' | 'invalid_request' | 'server' | 'network'
  class MetaError extends Error { kind; details: { status?; code?; subcode?; reason? } }
  function classifyGraphError(status: number, body: unknown): MetaError
  const GRAPH_API_VERSION = 'v24.0'
  function graphRequest<T>(req: GraphRequest): Promise<T>
  ```

- [ ] **Step 1: Scaffold the package**

`packages/meta/package.json`:
```json
{
  "name": "@replyooo/meta",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@replyooo/shared": "workspace:*",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@types/node": "^26.6.4",
    "msw": "^3.0.2",
    "typescript": "^7.0.2",
    "vitest": "^5.0.3"
  }
}
```

`packages/meta/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

Run: `pnpm install`
Expected: lockfile updated and `msw` installed.

`packages/meta/src/types.ts`:
```ts
import type { Platform } from '@replyooo/shared'

export interface AccountCredentials {
  /** Instagram professional account ID or Facebook Page ID (webhook `entry.id`). */
  externalId: string
  accessToken: string
}

export type SendableButton =
  | { type: 'url'; label: string; url: string }
  | { type: 'postback'; label: string; payload: string }

/** Exactly one Graph send call. */
export type SendableMessage =
  | { kind: 'text'; text: string; buttons?: SendableButton[] }
  | { kind: 'image'; url: string }

export interface SendResult {
  messageId: string | null
}

export interface Profile {
  name: string | null
  username: string | null
  avatarUrl: string | null
}

export interface TokenResult {
  accessToken: string
  expiresAt: Date | null
}

export interface IceBreaker {
  question: string
  payload: string
}

interface EventBase {
  platform: Platform
  /** The connected account the webhook was delivered for (`entry.id`). */
  accountExternalId: string
  /** Unique per logical event; stored as `webhook_events.dedup_key`. */
  dedupKey: string
  /** ISO timestamp, so the event stays JSON-safe in `webhook_events.payload`. */
  occurredAt: string
  /** IGSID / PSID of the person. */
  senderId: string
}

export type NormalizedEvent =
  | (EventBase & { type: 'dm_received'; messageId: string; text: string | null })
  | (EventBase & { type: 'story_reply'; messageId: string; text: string | null; isReaction: boolean })
  | (EventBase & { type: 'postback'; messageId: string | null; payload: string; title: string | null })
  | (EventBase & {
      type: 'comment_created'
      commentId: string
      mediaId: string
      text: string
      senderUsername: string | null
      senderName: string | null
    })

export type NormalizedEventType = NormalizedEvent['type']

export interface PlatformAdapter {
  readonly platform: Platform
  normalizeWebhook(payload: unknown): NormalizedEvent[]
  sendMessage(account: AccountCredentials, recipientId: string, message: SendableMessage): Promise<SendResult>
  sendPrivateReply(account: AccountCredentials, commentId: string, message: SendableMessage): Promise<SendResult>
  replyToComment(account: AccountCredentials, commentId: string, text: string): Promise<SendResult>
  getProfile(account: AccountCredentials, userId: string): Promise<Profile>
  getMediaPublishedAt(account: AccountCredentials, mediaId: string): Promise<Date | null>
  /** Instagram only. */
  isFollower?(account: AccountCredentials, userId: string): Promise<boolean>
  setIceBreakers(account: AccountCredentials, items: IceBreaker[]): Promise<void>
  subscribeWebhooks(account: AccountCredentials): Promise<void>
  refreshToken(account: AccountCredentials): Promise<TokenResult>
}
```

- [ ] **Step 2: Write the failing tests**

`packages/meta/test/errors.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { classifyGraphError, MetaError } from '../src'

const body = (code: number, error_subcode?: number) => ({
  error: { message: 'Graph says no', type: 'OAuthException', code, error_subcode },
})

describe('classifyGraphError', () => {
  it.each([
    [400, body(190), 'reauth', 'token_invalid'],
    [400, body(190, 460), 'reauth', 'token_invalid'],
    [400, body(10, 2018278), 'permanent', 'window_closed'],
    [400, body(10, 2534022), 'permanent', 'window_closed'],
    [400, body(551), 'permanent', 'user_unavailable'],
    [400, body(100, 2018001), 'permanent', 'user_unavailable'],
    [400, body(4), 'retryable', 'rate_limited'],
    [400, body(17), 'retryable', 'rate_limited'],
    [400, body(32), 'retryable', 'rate_limited'],
    [400, body(613), 'retryable', 'rate_limited'],
    [429, null, 'retryable', 'rate_limited'],
    [403, body(10), 'reauth', 'permission'],
    [403, body(200), 'reauth', 'permission'],
    [500, body(2), 'retryable', 'server'],
    [503, null, 'retryable', 'server'],
    [400, body(100), 'permanent', 'invalid_request'],
    [400, 'not json', 'permanent', 'invalid_request'],
  ] as const)('status %i %j → %s/%s', (status, payload, kind, reason) => {
    const error = classifyGraphError(status, payload)
    expect(error).toBeInstanceOf(MetaError)
    expect(error.kind).toBe(kind)
    expect(error.details.reason).toBe(reason)
    expect(error.details.status).toBe(status)
  })

  it('keeps the Graph message', () => {
    expect(classifyGraphError(400, body(100)).message).toBe('Graph says no')
    expect(classifyGraphError(502, null).message).toMatch(/502/)
  })
})
```

`packages/meta/test/graph.test.ts`:
```ts
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { graphRequest, MetaError } from '../src'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const base = 'https://graph.example.test/v24.0'

describe('graphRequest', () => {
  it('sends bearer auth, query and JSON body', async () => {
    let seen: { auth: string | null; query: string | null; body: unknown; type: string | null } | undefined
    server.use(
      http.post(`${base}/123/messages`, async ({ request }) => {
        seen = {
          auth: request.headers.get('authorization'),
          query: new URL(request.url).searchParams.get('fields'),
          type: request.headers.get('content-type'),
          body: await request.json(),
        }
        return HttpResponse.json({ message_id: 'mid.1' })
      }),
    )
    const result = await graphRequest<{ message_id: string }>({
      baseUrl: base,
      path: '/123/messages',
      token: 'tok',
      method: 'POST',
      query: { fields: 'id' },
      body: { hello: 'world' },
    })
    expect(result).toEqual({ message_id: 'mid.1' })
    expect(seen).toEqual({ auth: 'Bearer tok', query: 'id', type: 'application/json', body: { hello: 'world' } })
  })

  it('throws classified MetaErrors for Graph errors', async () => {
    server.use(
      http.get(`${base}/me`, () =>
        HttpResponse.json({ error: { message: 'Session expired', code: 190 } }, { status: 400 }),
      ),
    )
    const error = await graphRequest({ baseUrl: base, path: 'me', token: 'tok' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MetaError)
    expect((error as MetaError).kind).toBe('reauth')
  })

  it('treats network failures as retryable', async () => {
    server.use(http.get(`${base}/me`, () => HttpResponse.error()))
    const error = await graphRequest({ baseUrl: base, path: 'me', token: 'tok' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MetaError)
    expect((error as MetaError).kind).toBe('retryable')
    expect((error as MetaError).details.reason).toBe('network')
  })

  it('returns an empty object for empty success bodies', async () => {
    server.use(http.delete(`${base}/x`, () => new HttpResponse(null, { status: 200 })))
    await expect(graphRequest({ baseUrl: base, path: 'x', token: 't', method: 'DELETE' })).resolves.toEqual({})
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @replyooo/meta test`
Expected: FAIL. `../src` has no exports yet.

- [ ] **Step 4: Implement**

`packages/meta/src/errors.ts`:
```ts
export type MetaErrorKind = 'retryable' | 'reauth' | 'permanent'

export type MetaFailureReason =
  | 'window_closed'
  | 'user_unavailable'
  | 'rate_limited'
  | 'token_invalid'
  | 'permission'
  | 'invalid_request'
  | 'server'
  | 'network'

export interface MetaErrorDetails {
  status?: number
  code?: number
  subcode?: number
  reason?: MetaFailureReason
}

export class MetaError extends Error {
  constructor(
    readonly kind: MetaErrorKind,
    message: string,
    readonly details: MetaErrorDetails = {},
  ) {
    super(message)
    this.name = 'MetaError'
  }
}

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number }
}

const TOKEN_CODES = new Set([102, 190, 463, 467])
const WINDOW_SUBCODES = new Set([2018278, 2534022])
const USER_UNAVAILABLE_SUBCODES = new Set([2018001, 2534014])
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613])

export function classifyGraphError(status: number, body: unknown): MetaError {
  const error =
    body !== null && typeof body === 'object' ? ((body as GraphErrorBody).error ?? {}) : {}
  const { code, error_subcode: subcode } = error
  const message = error.message ?? `Graph API request failed with status ${status}`
  const make = (kind: MetaErrorKind, reason: MetaFailureReason) =>
    new MetaError(kind, message, { status, code, subcode, reason })

  if (code !== undefined && TOKEN_CODES.has(code)) return make('reauth', 'token_invalid')
  if (subcode !== undefined && WINDOW_SUBCODES.has(subcode)) return make('permanent', 'window_closed')
  if (code === 551 || (subcode !== undefined && USER_UNAVAILABLE_SUBCODES.has(subcode))) {
    return make('permanent', 'user_unavailable')
  }
  if (status === 429 || (code !== undefined && RATE_LIMIT_CODES.has(code))) return make('retryable', 'rate_limited')
  if (code === 10 || (code !== undefined && code >= 200 && code <= 299)) return make('reauth', 'permission')
  if (status >= 500 || code === 1 || code === 2) return make('retryable', 'server')
  return make('permanent', 'invalid_request')
}
```

`packages/meta/src/graph.ts`:
```ts
import { classifyGraphError, MetaError } from './errors'

export const GRAPH_API_VERSION = 'v24.0'
const TIMEOUT_MS = 15_000

export interface GraphRequest {
  baseUrl: string
  path: string
  token: string
  method?: 'GET' | 'POST' | 'DELETE'
  query?: Record<string, string>
  body?: unknown
}

export async function graphRequest<T>(req: GraphRequest): Promise<T> {
  const url = new URL(`${req.baseUrl}/${req.path.replace(/^\//, '')}`)
  for (const [key, value] of Object.entries(req.query ?? {})) url.searchParams.set(key, value)

  const headers: Record<string, string> = { Authorization: `Bearer ${req.token}` }
  if (req.body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(url, {
      method: req.method ?? 'GET',
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (cause) {
    throw new MetaError('retryable', `Graph API request failed: ${(cause as Error).message}`, {
      reason: 'network',
    })
  }

  const text = await response.text()
  let body: unknown = {}
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!response.ok || (body !== null && typeof body === 'object' && 'error' in body)) {
    throw classifyGraphError(response.status, body)
  }
  return body as T
}
```

`packages/meta/src/index.ts`:
```ts
export * from './types'
export * from './errors'
export * from './graph'
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @replyooo/meta test && pnpm --filter @replyooo/meta typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/meta pnpm-lock.yaml
git commit -m "feat(meta): add adapter types, Graph client and error classification"
```

---

### Task 4: Meta: outbound message payloads

**Files:**
- Create: `packages/meta/src/messages.ts`
- Modify: `packages/meta/src/index.ts`
- Test: `packages/meta/test/messages.test.ts`

**Interfaces:**
- Produces:
  ```ts
  const MAX_TEXT_LENGTH = 1000
  const MAX_BUTTON_TEXT_LENGTH = 640
  function toGraphMessage(message: SendableMessage): Record<string, unknown>   // the Graph `message` field
  ```

- [ ] **Step 1: Write the failing test**

`packages/meta/test/messages.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { toGraphMessage } from '../src'

describe('toGraphMessage', () => {
  it('sends plain text', () => {
    expect(toGraphMessage({ kind: 'text', text: 'Hi Priya' })).toEqual({ text: 'Hi Priya' })
    expect(toGraphMessage({ kind: 'text', text: 'Hi', buttons: [] })).toEqual({ text: 'Hi' })
  })

  it('uses a button template for buttons', () => {
    expect(
      toGraphMessage({
        kind: 'text',
        text: 'Tap below',
        buttons: [
          { type: 'postback', label: 'Send it', payload: 'r:run:s1:b1' },
          { type: 'url', label: 'Shop', url: 'https://shop.example.com' },
        ],
      }),
    ).toEqual({
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text: 'Tap below',
          buttons: [
            { type: 'postback', title: 'Send it', payload: 'r:run:s1:b1' },
            { type: 'web_url', title: 'Shop', url: 'https://shop.example.com' },
          ],
        },
      },
    })
  })

  it('truncates rendered text to Meta limits', () => {
    const plain = toGraphMessage({ kind: 'text', text: 'a'.repeat(1200) }) as { text: string }
    expect(plain.text).toHaveLength(1000)
    expect(plain.text.endsWith('…')).toBe(true)

    const withButtons = toGraphMessage({
      kind: 'text',
      text: 'b'.repeat(700),
      buttons: [{ type: 'postback', label: 'Go', payload: 'p' }],
    }) as { attachment: { payload: { text: string } } }
    expect(withButtons.attachment.payload.text).toHaveLength(640)
  })

  it('sends images as attachments', () => {
    expect(toGraphMessage({ kind: 'image', url: 'https://cdn.example.com/a.jpg' })).toEqual({
      attachment: { type: 'image', payload: { url: 'https://cdn.example.com/a.jpg' } },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @replyooo/meta test messages`
Expected: FAIL. `toGraphMessage` isn't exported yet.

- [ ] **Step 3: Implement**

`packages/meta/src/messages.ts`:
```ts
import type { SendableMessage } from './types'

export const MAX_TEXT_LENGTH = 1000
export const MAX_BUTTON_TEXT_LENGTH = 640

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

export function toGraphMessage(message: SendableMessage): Record<string, unknown> {
  if (message.kind === 'image') {
    return { attachment: { type: 'image', payload: { url: message.url } } }
  }
  const buttons = message.buttons ?? []
  if (buttons.length === 0) return { text: truncate(message.text, MAX_TEXT_LENGTH) }
  return {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'button',
        text: truncate(message.text, MAX_BUTTON_TEXT_LENGTH),
        buttons: buttons.map((button) =>
          button.type === 'url'
            ? { type: 'web_url', title: button.label, url: button.url }
            : { type: 'postback', title: button.label, payload: button.payload },
        ),
      },
    },
  }
}
```

Append to `packages/meta/src/index.ts`:
```ts
export * from './messages'
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @replyooo/meta test && pnpm --filter @replyooo/meta typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/meta
git commit -m "feat(meta): build Graph message payloads"
```

---

### Task 5: Meta: webhook normalization

**Files:**
- Create: `packages/meta/src/normalize.ts`, `packages/meta/test/fixtures.ts`
- Modify: `packages/meta/src/index.ts`
- Test: `packages/meta/test/normalize.test.ts`

**Interfaces:**
- Produces:
  ```ts
  function normalizeInstagramWebhook(payload: unknown): NormalizedEvent[]   // object === 'instagram'
  function normalizeFacebookWebhook(payload: unknown): NormalizedEvent[]    // object === 'page'
  ```
  Rules (both platforms):
  - `messaging[]`: skip items whose `sender.id === entry.id` (echoes and our own sends), `message.is_echo`, `message.is_deleted`, and anything that isn't a message or postback (read, delivery, reactions, referrals).
  - `postback` → `postback` (dedup `<platform>:postback:<mid>`, or `<senderId>:<timestamp>` without a mid). `message.quick_reply` → `postback` with the quick-reply payload.
  - `message.reply_to.story` (Instagram) → `story_reply`. `isReaction` is true when the text has no letters or digits (emoji-only quick reactions).
  - Other messages → `dm_received` (`text` is `null` for attachment-only messages). Dedup `<platform>:message:<mid>`.
  - Instagram `changes[field=comments]` → `comment_created` (dedup `instagram:comment:<id>`). Facebook `changes[field=feed]` with `item: 'comment'` and `verb: 'add'` → `comment_created` (dedup `facebook:comment:<comment_id>`, `mediaId` = `post_id`). Comments from the account itself are skipped (prevents loops with our public replies).
  - Malformed items are skipped. Wrong `object` or garbage → `[]`. Never throws.

  > Payload shapes follow Meta's docs for Instagram API with Instagram Login and Messenger Platform webhooks. Story reactions and comment `from.id` = messaging IGSID are assumptions: check both against real payloads in the manual E2E pass (spec §8) and update fixtures if they differ.

- [ ] **Step 1: Write fixtures and the failing test**

`packages/meta/test/fixtures.ts`:
```ts
export const IG_ACCOUNT = '17841400000000001'
export const FB_PAGE = '104000000000001'
export const T = 1791280800000 // 2026-10-06T10:00:00.000Z

const igMessaging = (item: Record<string, unknown>) => ({
  object: 'instagram',
  entry: [{ id: IG_ACCOUNT, time: T, messaging: [{ recipient: { id: IG_ACCOUNT }, timestamp: T, ...item }] }],
})

export const ig = {
  dm: igMessaging({ sender: { id: 'igsid_1' }, message: { mid: 'mid.dm1', text: 'PRICE?' } }),
  attachmentOnly: igMessaging({
    sender: { id: 'igsid_1' },
    message: { mid: 'mid.img', attachments: [{ type: 'image', payload: { url: 'https://x' } }] },
  }),
  echo: igMessaging({ sender: { id: IG_ACCOUNT }, message: { mid: 'mid.echo', text: 'hi', is_echo: true } }),
  deleted: igMessaging({ sender: { id: 'igsid_1' }, message: { mid: 'mid.del', is_deleted: true } }),
  read: igMessaging({ sender: { id: 'igsid_1' }, read: { mid: 'mid.dm1' } }),
  quickReply: igMessaging({
    sender: { id: 'igsid_1' },
    message: { mid: 'mid.qr', text: 'Send it', quick_reply: { payload: 'r:run1:s1:b1' } },
  }),
  postback: igMessaging({
    sender: { id: 'igsid_1' },
    postback: { mid: 'mid.pb', title: 'Send it', payload: 'r:run1:s1:b1' },
  }),
  storyReply: igMessaging({
    sender: { id: 'igsid_1' },
    message: { mid: 'mid.story', text: 'I want this', reply_to: { story: { id: 'story1', url: 'https://x' } } },
  }),
  storyReaction: igMessaging({
    sender: { id: 'igsid_1' },
    message: { mid: 'mid.react', text: '😍🔥', reply_to: { story: { id: 'story1', url: 'https://x' } } },
  }),
  comment: {
    object: 'instagram',
    entry: [
      {
        id: IG_ACCOUNT,
        time: T / 1000,
        changes: [
          {
            field: 'comments',
            value: {
              id: 'c1',
              text: 'GUIDE please',
              from: { id: 'igsid_2', username: 'priya' },
              media: { id: 'media1', media_product_type: 'FEED' },
            },
          },
        ],
      },
    ],
  },
  ownComment: {
    object: 'instagram',
    entry: [
      {
        id: IG_ACCOUNT,
        time: T / 1000,
        changes: [
          {
            field: 'comments',
            value: { id: 'c2', text: 'Sent you a DM!', from: { id: IG_ACCOUNT, username: 'acme' }, media: { id: 'media1' } },
          },
        ],
      },
    ],
  },
  batch: {
    object: 'instagram',
    entry: [
      {
        id: IG_ACCOUNT,
        time: T,
        messaging: [
          { sender: { id: 'igsid_1' }, recipient: { id: IG_ACCOUNT }, timestamp: T, message: { mid: 'm.a', text: 'a' } },
          { sender: { id: 'igsid_3' }, recipient: { id: IG_ACCOUNT }, timestamp: T, message: { mid: 'm.b', text: 'b' } },
          { garbage: true },
        ],
      },
    ],
  },
}

const fbFeed = (value: Record<string, unknown>) => ({
  object: 'page',
  entry: [{ id: FB_PAGE, time: T / 1000, changes: [{ field: 'feed', value }] }],
})

export const fb = {
  dm: {
    object: 'page',
    entry: [
      {
        id: FB_PAGE,
        time: T,
        messaging: [{ sender: { id: 'psid_1' }, recipient: { id: FB_PAGE }, timestamp: T, message: { mid: 'm_fb1', text: 'hello' } }],
      },
    ],
  },
  postback: {
    object: 'page',
    entry: [
      {
        id: FB_PAGE,
        time: T,
        messaging: [
          {
            sender: { id: 'psid_1' },
            recipient: { id: FB_PAGE },
            timestamp: T,
            postback: { mid: 'm_fbpb', title: 'Pricing', payload: 'ib:auto1:0' },
          },
        ],
      },
    ],
  },
  comment: fbFeed({
    item: 'comment',
    verb: 'add',
    comment_id: '104_c1',
    post_id: '104_p1',
    message: 'guide',
    from: { id: 'fbuser_1', name: 'Priya Sharma' },
    created_time: T / 1000,
  }),
  editedComment: fbFeed({
    item: 'comment',
    verb: 'edited',
    comment_id: '104_c1',
    post_id: '104_p1',
    message: 'guide!!',
    from: { id: 'fbuser_1', name: 'Priya Sharma' },
  }),
  pageComment: fbFeed({
    item: 'comment',
    verb: 'add',
    comment_id: '104_c2',
    post_id: '104_p1',
    message: 'Check your inbox',
    from: { id: FB_PAGE, name: 'Acme' },
  }),
  statusPost: fbFeed({ item: 'status', verb: 'add', post_id: '104_p2', message: 'New post' }),
}
```

`packages/meta/test/normalize.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { normalizeFacebookWebhook, normalizeInstagramWebhook } from '../src'
import { FB_PAGE, fb, IG_ACCOUNT, ig, T } from './fixtures'

const at = new Date(T).toISOString()

describe('normalizeInstagramWebhook', () => {
  it('normalizes DMs', () => {
    expect(normalizeInstagramWebhook(ig.dm)).toEqual([
      {
        platform: 'instagram',
        type: 'dm_received',
        accountExternalId: IG_ACCOUNT,
        senderId: 'igsid_1',
        dedupKey: 'instagram:message:mid.dm1',
        occurredAt: at,
        messageId: 'mid.dm1',
        text: 'PRICE?',
      },
    ])
  })

  it('keeps attachment-only messages with null text', () => {
    expect(normalizeInstagramWebhook(ig.attachmentOnly)).toMatchObject([{ type: 'dm_received', text: null }])
  })

  it('ignores echoes, deletions and read receipts', () => {
    expect(normalizeInstagramWebhook(ig.echo)).toEqual([])
    expect(normalizeInstagramWebhook(ig.deleted)).toEqual([])
    expect(normalizeInstagramWebhook(ig.read)).toEqual([])
  })

  it('turns postbacks and quick replies into postback events', () => {
    expect(normalizeInstagramWebhook(ig.postback)).toEqual([
      {
        platform: 'instagram',
        type: 'postback',
        accountExternalId: IG_ACCOUNT,
        senderId: 'igsid_1',
        dedupKey: 'instagram:postback:mid.pb',
        occurredAt: at,
        messageId: 'mid.pb',
        payload: 'r:run1:s1:b1',
        title: 'Send it',
      },
    ])
    expect(normalizeInstagramWebhook(ig.quickReply)).toMatchObject([
      { type: 'postback', payload: 'r:run1:s1:b1', dedupKey: 'instagram:message:mid.qr' },
    ])
  })

  it('detects story replies and emoji-only reactions', () => {
    expect(normalizeInstagramWebhook(ig.storyReply)).toMatchObject([
      { type: 'story_reply', text: 'I want this', isReaction: false },
    ])
    expect(normalizeInstagramWebhook(ig.storyReaction)).toMatchObject([
      { type: 'story_reply', text: '😍🔥', isReaction: true },
    ])
  })

  it('normalizes comments', () => {
    expect(normalizeInstagramWebhook(ig.comment)).toEqual([
      {
        platform: 'instagram',
        type: 'comment_created',
        accountExternalId: IG_ACCOUNT,
        senderId: 'igsid_2',
        senderUsername: 'priya',
        senderName: null,
        dedupKey: 'instagram:comment:c1',
        occurredAt: at,
        commentId: 'c1',
        mediaId: 'media1',
        text: 'GUIDE please',
      },
    ])
  })

  it('ignores comments made by the account itself', () => {
    expect(normalizeInstagramWebhook(ig.ownComment)).toEqual([])
  })

  it('handles batches and skips malformed items', () => {
    expect(normalizeInstagramWebhook(ig.batch).map((e) => e.senderId)).toEqual(['igsid_1', 'igsid_3'])
  })

  it('returns [] for other objects and garbage', () => {
    expect(normalizeInstagramWebhook(fb.dm)).toEqual([])
    expect(normalizeInstagramWebhook(null)).toEqual([])
    expect(normalizeInstagramWebhook({ object: 'instagram', entry: 'nope' })).toEqual([])
  })
})

describe('normalizeFacebookWebhook', () => {
  it('normalizes Messenger DMs and postbacks', () => {
    expect(normalizeFacebookWebhook(fb.dm)).toMatchObject([
      { platform: 'facebook', type: 'dm_received', accountExternalId: FB_PAGE, senderId: 'psid_1', text: 'hello' },
    ])
    expect(normalizeFacebookWebhook(fb.postback)).toMatchObject([
      { type: 'postback', payload: 'ib:auto1:0', dedupKey: 'facebook:postback:m_fbpb' },
    ])
  })

  it('normalizes new comments only', () => {
    expect(normalizeFacebookWebhook(fb.comment)).toEqual([
      {
        platform: 'facebook',
        type: 'comment_created',
        accountExternalId: FB_PAGE,
        senderId: 'fbuser_1',
        senderUsername: null,
        senderName: 'Priya Sharma',
        dedupKey: 'facebook:comment:104_c1',
        occurredAt: at,
        commentId: '104_c1',
        mediaId: '104_p1',
        text: 'guide',
      },
    ])
    expect(normalizeFacebookWebhook(fb.editedComment)).toEqual([])
    expect(normalizeFacebookWebhook(fb.pageComment)).toEqual([])
    expect(normalizeFacebookWebhook(fb.statusPost)).toEqual([])
  })

  it('returns [] for Instagram payloads', () => {
    expect(normalizeFacebookWebhook(ig.dm)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @replyooo/meta test normalize`
Expected: FAIL. The normalizers aren't exported yet.

- [ ] **Step 3: Implement**

`packages/meta/src/normalize.ts`:
```ts
import type { Platform } from '@replyooo/shared'
import { z } from 'zod'
import type { NormalizedEvent } from './types'

const Ref = z.looseObject({ id: z.string() })

const MessagingSchema = z.looseObject({
  sender: Ref,
  recipient: Ref,
  timestamp: z.number(),
  message: z
    .looseObject({
      mid: z.string(),
      text: z.string().optional(),
      is_echo: z.boolean().optional(),
      is_deleted: z.boolean().optional(),
      quick_reply: z.looseObject({ payload: z.string() }).optional(),
      reply_to: z.looseObject({ story: z.looseObject({}).optional() }).optional(),
    })
    .optional(),
  postback: z
    .looseObject({ mid: z.string().optional(), title: z.string().optional(), payload: z.string() })
    .optional(),
})

const EntrySchema = z.looseObject({
  id: z.string(),
  time: z.number().optional(),
  messaging: z.array(z.unknown()).optional(),
  changes: z.array(z.looseObject({ field: z.string(), value: z.unknown() })).optional(),
})

const PayloadSchema = z.looseObject({ object: z.string(), entry: z.array(EntrySchema) })

const InstagramCommentSchema = z.looseObject({
  id: z.string(),
  text: z.string().default(''),
  from: z.looseObject({ id: z.string(), username: z.string().optional() }),
  media: Ref,
})

const FacebookFeedSchema = z.looseObject({
  item: z.string(),
  verb: z.string(),
  comment_id: z.string().optional(),
  post_id: z.string().optional(),
  message: z.string().optional(),
  from: z.looseObject({ id: z.string(), name: z.string().optional() }).optional(),
  created_time: z.number().optional(),
})

type Entry = z.infer<typeof EntrySchema>
type ChangeHandler = (entry: Entry, field: string, value: unknown) => NormalizedEvent | null

/** Meta sends seconds for `changes` and milliseconds for `messaging`. */
function toIso(time: number | undefined): string {
  if (time === undefined) return new Date().toISOString()
  return new Date(time < 1e12 ? time * 1000 : time).toISOString()
}

const hasWordCharacters = (text: string) => /[\p{L}\p{N}]/u.test(text)

function normalize(
  platform: Platform,
  expectedObject: string,
  payload: unknown,
  onChange: ChangeHandler,
): NormalizedEvent[] {
  const parsed = PayloadSchema.safeParse(payload)
  if (!parsed.success || parsed.data.object !== expectedObject) return []
  const events: NormalizedEvent[] = []
  for (const entry of parsed.data.entry) {
    for (const item of entry.messaging ?? []) {
      const event = messagingEvent(platform, entry.id, item)
      if (event) events.push(event)
    }
    for (const change of entry.changes ?? []) {
      const event = onChange(entry, change.field, change.value)
      if (event) events.push(event)
    }
  }
  return events
}

function messagingEvent(platform: Platform, accountExternalId: string, raw: unknown): NormalizedEvent | null {
  const parsed = MessagingSchema.safeParse(raw)
  if (!parsed.success) return null
  const item = parsed.data
  const senderId = item.sender.id
  if (senderId === accountExternalId) return null
  const base = { platform, accountExternalId, senderId, occurredAt: toIso(item.timestamp) }

  if (item.postback) {
    const mid = item.postback.mid ?? null
    return {
      ...base,
      type: 'postback',
      dedupKey: `${platform}:postback:${mid ?? `${senderId}:${item.timestamp}`}`,
      messageId: mid,
      payload: item.postback.payload,
      title: item.postback.title ?? null,
    }
  }

  const message = item.message
  if (!message || message.is_echo || message.is_deleted) return null
  const dedupKey = `${platform}:message:${message.mid}`

  if (message.quick_reply) {
    return {
      ...base,
      type: 'postback',
      dedupKey,
      messageId: message.mid,
      payload: message.quick_reply.payload,
      title: message.text ?? null,
    }
  }

  const text = message.text && message.text.trim().length > 0 ? message.text : null
  if (message.reply_to?.story) {
    return {
      ...base,
      type: 'story_reply',
      dedupKey,
      messageId: message.mid,
      text,
      isReaction: text !== null && !hasWordCharacters(text),
    }
  }
  return { ...base, type: 'dm_received', dedupKey, messageId: message.mid, text }
}

const instagramComment: ChangeHandler = (entry, field, value) => {
  if (field !== 'comments') return null
  const parsed = InstagramCommentSchema.safeParse(value)
  if (!parsed.success) return null
  const comment = parsed.data
  if (comment.from.id === entry.id) return null
  return {
    platform: 'instagram',
    type: 'comment_created',
    accountExternalId: entry.id,
    senderId: comment.from.id,
    senderUsername: comment.from.username ?? null,
    senderName: null,
    dedupKey: `instagram:comment:${comment.id}`,
    occurredAt: toIso(entry.time),
    commentId: comment.id,
    mediaId: comment.media.id,
    text: comment.text,
  }
}

const facebookComment: ChangeHandler = (entry, field, value) => {
  if (field !== 'feed') return null
  const parsed = FacebookFeedSchema.safeParse(value)
  if (!parsed.success) return null
  const feed = parsed.data
  if (feed.item !== 'comment' || feed.verb !== 'add') return null
  if (!feed.comment_id || !feed.post_id || !feed.from || feed.from.id === entry.id) return null
  return {
    platform: 'facebook',
    type: 'comment_created',
    accountExternalId: entry.id,
    senderId: feed.from.id,
    senderUsername: null,
    senderName: feed.from.name ?? null,
    dedupKey: `facebook:comment:${feed.comment_id}`,
    occurredAt: toIso(feed.created_time ?? entry.time),
    commentId: feed.comment_id,
    mediaId: feed.post_id,
    text: feed.message ?? '',
  }
}

export function normalizeInstagramWebhook(payload: unknown): NormalizedEvent[] {
  return normalize('instagram', 'instagram', payload, instagramComment)
}

export function normalizeFacebookWebhook(payload: unknown): NormalizedEvent[] {
  return normalize('facebook', 'page', payload, facebookComment)
}
```

Append to `packages/meta/src/index.ts`:
```ts
export * from './normalize'
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @replyooo/meta test && pnpm --filter @replyooo/meta typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/meta
git commit -m "feat(meta): normalize Instagram and Facebook webhooks"
```

---

### Task 6: Meta: Instagram adapter

**Files:**
- Create: `packages/meta/src/instagram.ts`
- Modify: `packages/meta/src/index.ts`
- Test: `packages/meta/test/instagram.test.ts`

**Interfaces:**
- Produces: `function createInstagramAdapter(options?: { graphVersion?: string }): PlatformAdapter`

  | Method | Graph call (base `https://graph.instagram.com/<v>`) |
  |---|---|
  | `sendMessage` | `POST /{externalId}/messages` `{ recipient: { id }, message }` → `message_id` |
  | `sendPrivateReply` | `POST /{externalId}/messages` `{ recipient: { comment_id }, message }` |
  | `replyToComment` | `POST /{commentId}/replies` `{ message: text }` → `id` |
  | `getProfile` | `GET /{userId}?fields=name,username,profile_pic` |
  | `getMediaPublishedAt` | `GET /{mediaId}?fields=timestamp` |
  | `isFollower` | `GET /{userId}?fields=is_user_follow_business` |
  | `setIceBreakers` | `POST /{externalId}/messenger_profile` `{ platform: 'instagram', ice_breakers: [{ locale: 'default', call_to_actions }] }`; empty list → `DELETE` with `{ platform, fields: ['ice_breakers'] }` |
  | `subscribeWebhooks` | `POST /{externalId}/subscribed_apps?subscribed_fields=comments,messages,messaging_postbacks` |
  | `refreshToken` | `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=…` → `{ access_token, expires_in }` |

- [ ] **Step 1: Write the failing test**

`packages/meta/test/instagram.test.ts`:
```ts
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createInstagramAdapter, MetaError } from '../src'
import { IG_ACCOUNT, ig } from './fixtures'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const base = 'https://graph.instagram.com/v24.0'
const account = { externalId: IG_ACCOUNT, accessToken: 'IGAAT' }
const adapter = createInstagramAdapter()

function capture(method: 'get' | 'post' | 'delete', url: string, response: unknown) {
  const calls: { body: unknown; search: URLSearchParams; auth: string | null }[] = []
  server.use(
    http[method](url, async ({ request }) => {
      const text = await request.text()
      calls.push({
        body: text ? JSON.parse(text) : null,
        search: new URL(request.url).searchParams,
        auth: request.headers.get('authorization'),
      })
      return HttpResponse.json(response as Record<string, unknown>)
    }),
  )
  return calls
}

describe('createInstagramAdapter', () => {
  it('normalizes Instagram webhooks', () => {
    expect(adapter.platform).toBe('instagram')
    expect(adapter.normalizeWebhook(ig.dm)).toHaveLength(1)
  })

  it('sends DMs', async () => {
    const calls = capture('post', `${base}/${IG_ACCOUNT}/messages`, { recipient_id: 'igsid_1', message_id: 'mid.out' })
    const result = await adapter.sendMessage(account, 'igsid_1', { kind: 'text', text: 'Hi' })
    expect(result).toEqual({ messageId: 'mid.out' })
    expect(calls[0]?.body).toEqual({ recipient: { id: 'igsid_1' }, message: { text: 'Hi' } })
    expect(calls[0]?.auth).toBe('Bearer IGAAT')
  })

  it('sends private replies to a comment', async () => {
    const calls = capture('post', `${base}/${IG_ACCOUNT}/messages`, { message_id: 'mid.pr' })
    await adapter.sendPrivateReply(account, 'c1', {
      kind: 'text',
      text: 'Tap below',
      buttons: [{ type: 'postback', label: 'Send it', payload: 'r:run:s1:b1' }],
    })
    expect(calls[0]?.body).toMatchObject({
      recipient: { comment_id: 'c1' },
      message: { attachment: { type: 'template' } },
    })
  })

  it('replies publicly to comments', async () => {
    const calls = capture('post', `${base}/c1/replies`, { id: 'c1_reply' })
    expect(await adapter.replyToComment(account, 'c1', 'Check your DMs!')).toEqual({ messageId: 'c1_reply' })
    expect(calls[0]?.body).toEqual({ message: 'Check your DMs!' })
  })

  it('reads profiles, follow status and media time', async () => {
    server.use(
      http.get(`${base}/igsid_1`, ({ request }) => {
        const fields = new URL(request.url).searchParams.get('fields')
        if (fields === 'is_user_follow_business') return HttpResponse.json({ is_user_follow_business: true })
        return HttpResponse.json({ name: 'Priya Sharma', username: 'priya', profile_pic: 'https://pic' })
      }),
      http.get(`${base}/media1`, () => HttpResponse.json({ timestamp: '2026-10-01T09:00:00+0000' })),
    )
    expect(await adapter.getProfile(account, 'igsid_1')).toEqual({
      name: 'Priya Sharma',
      username: 'priya',
      avatarUrl: 'https://pic',
    })
    expect(await adapter.isFollower?.(account, 'igsid_1')).toBe(true)
    expect((await adapter.getMediaPublishedAt(account, 'media1'))?.toISOString()).toBe('2026-10-01T09:00:00.000Z')
  })

  it('sets and clears ice breakers', async () => {
    const posts = capture('post', `${base}/${IG_ACCOUNT}/messenger_profile`, { result: 'success' })
    await adapter.setIceBreakers(account, [{ question: 'Pricing?', payload: 'ib:a1:0' }])
    expect(posts[0]?.body).toEqual({
      platform: 'instagram',
      ice_breakers: [{ locale: 'default', call_to_actions: [{ question: 'Pricing?', payload: 'ib:a1:0' }] }],
    })
    const deletes = capture('delete', `${base}/${IG_ACCOUNT}/messenger_profile`, { result: 'success' })
    await adapter.setIceBreakers(account, [])
    expect(deletes[0]?.body).toEqual({ platform: 'instagram', fields: ['ice_breakers'] })
  })

  it('subscribes to webhooks', async () => {
    const calls = capture('post', `${base}/${IG_ACCOUNT}/subscribed_apps`, { success: true })
    await adapter.subscribeWebhooks(account)
    expect(calls[0]?.search.get('subscribed_fields')).toBe('comments,messages,messaging_postbacks')
  })

  it('refreshes long-lived tokens', async () => {
    const calls = capture('get', 'https://graph.instagram.com/refresh_access_token', {
      access_token: 'IGAAT-new',
      token_type: 'bearer',
      expires_in: 5184000,
    })
    const before = Date.now()
    const result = await adapter.refreshToken(account)
    expect(result.accessToken).toBe('IGAAT-new')
    expect(result.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 5184000 * 1000)
    expect(calls[0]?.search.get('grant_type')).toBe('ig_refresh_token')
    expect(calls[0]?.search.get('access_token')).toBe('IGAAT')
  })

  it('surfaces Graph errors as MetaError', async () => {
    server.use(
      http.post(`${base}/${IG_ACCOUNT}/messages`, () =>
        HttpResponse.json({ error: { message: 'Outside window', code: 10, error_subcode: 2534022 } }, { status: 400 }),
      ),
    )
    const error = await adapter.sendMessage(account, 'igsid_1', { kind: 'text', text: 'Hi' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MetaError)
    expect((error as MetaError).details.reason).toBe('window_closed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @replyooo/meta test instagram`
Expected: FAIL. `createInstagramAdapter` isn't exported yet.

- [ ] **Step 3: Implement**

`packages/meta/src/instagram.ts`:
```ts
import { GRAPH_API_VERSION, graphRequest } from './graph'
import { toGraphMessage } from './messages'
import { normalizeInstagramWebhook } from './normalize'
import type { AccountCredentials, PlatformAdapter } from './types'

const HOST = 'https://graph.instagram.com'

export function createInstagramAdapter(options: { graphVersion?: string } = {}): PlatformAdapter {
  const baseUrl = `${HOST}/${options.graphVersion ?? GRAPH_API_VERSION}`
  const call = <T>(
    account: AccountCredentials,
    path: string,
    init: { method?: 'GET' | 'POST' | 'DELETE'; query?: Record<string, string>; body?: unknown } = {},
  ) => graphRequest<T>({ baseUrl, path, token: account.accessToken, ...init })

  return {
    platform: 'instagram',
    normalizeWebhook: normalizeInstagramWebhook,

    async sendMessage(account, recipientId, message) {
      const res = await call<{ message_id?: string }>(account, `${account.externalId}/messages`, {
        method: 'POST',
        body: { recipient: { id: recipientId }, message: toGraphMessage(message) },
      })
      return { messageId: res.message_id ?? null }
    },

    async sendPrivateReply(account, commentId, message) {
      const res = await call<{ message_id?: string }>(account, `${account.externalId}/messages`, {
        method: 'POST',
        body: { recipient: { comment_id: commentId }, message: toGraphMessage(message) },
      })
      return { messageId: res.message_id ?? null }
    },

    async replyToComment(account, commentId, text) {
      const res = await call<{ id?: string }>(account, `${commentId}/replies`, {
        method: 'POST',
        body: { message: text },
      })
      return { messageId: res.id ?? null }
    },

    async getProfile(account, userId) {
      const res = await call<{ name?: string; username?: string; profile_pic?: string }>(account, userId, {
        query: { fields: 'name,username,profile_pic' },
      })
      return { name: res.name ?? null, username: res.username ?? null, avatarUrl: res.profile_pic ?? null }
    },

    async getMediaPublishedAt(account, mediaId) {
      const res = await call<{ timestamp?: string }>(account, mediaId, { query: { fields: 'timestamp' } })
      return res.timestamp ? new Date(res.timestamp) : null
    },

    async isFollower(account, userId) {
      const res = await call<{ is_user_follow_business?: boolean }>(account, userId, {
        query: { fields: 'is_user_follow_business' },
      })
      return res.is_user_follow_business === true
    },

    async setIceBreakers(account, items) {
      const path = `${account.externalId}/messenger_profile`
      if (items.length === 0) {
        await call(account, path, { method: 'DELETE', body: { platform: 'instagram', fields: ['ice_breakers'] } })
        return
      }
      await call(account, path, {
        method: 'POST',
        body: {
          platform: 'instagram',
          ice_breakers: [
            { locale: 'default', call_to_actions: items.map((i) => ({ question: i.question, payload: i.payload })) },
          ],
        },
      })
    },

    async subscribeWebhooks(account) {
      await call(account, `${account.externalId}/subscribed_apps`, {
        method: 'POST',
        query: { subscribed_fields: 'comments,messages,messaging_postbacks' },
      })
    },

    async refreshToken(account) {
      const res = await graphRequest<{ access_token: string; expires_in: number }>({
        baseUrl: HOST,
        path: 'refresh_access_token',
        token: account.accessToken,
        query: { grant_type: 'ig_refresh_token', access_token: account.accessToken },
      })
      return { accessToken: res.access_token, expiresAt: new Date(Date.now() + res.expires_in * 1000) }
    },
  }
}
```

Append to `packages/meta/src/index.ts`:
```ts
export * from './instagram'
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @replyooo/meta test && pnpm --filter @replyooo/meta typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/meta
git commit -m "feat(meta): add Instagram adapter"
```

---

### Task 7: Meta: Facebook adapter

**Files:**
- Create: `packages/meta/src/facebook.ts`
- Modify: `packages/meta/src/index.ts`
- Test: `packages/meta/test/facebook.test.ts`

**Interfaces:**
- Produces: `function createFacebookAdapter(options?: { graphVersion?: string }): PlatformAdapter` (no `isFollower`)

  | Method | Graph call (base `https://graph.facebook.com/<v>`, Page token) |
  |---|---|
  | `sendMessage` | `POST /{pageId}/messages` `{ recipient: { id }, messaging_type: 'RESPONSE', message }` |
  | `sendPrivateReply` | `POST /{pageId}/messages` `{ recipient: { comment_id }, message }` |
  | `replyToComment` | `POST /{commentId}/comments` `{ message: text }` → `id` |
  | `getProfile` | `GET /{psid}?fields=name,profile_pic` (username always `null`) |
  | `getMediaPublishedAt` | `GET /{postId}?fields=created_time` |
  | `setIceBreakers` | `POST /me/messenger_profile` `{ ice_breakers: [...] }`; empty → `DELETE` `{ fields: ['ice_breakers'] }` |
  | `subscribeWebhooks` | `POST /{pageId}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,feed` |
  | `refreshToken` | no call. Page tokens from a long-lived user token don't expire → `{ accessToken, expiresAt: null }` |

- [ ] **Step 1: Write the failing test**

`packages/meta/test/facebook.test.ts`:
```ts
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createFacebookAdapter } from '../src'
import { FB_PAGE, fb } from './fixtures'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const base = 'https://graph.facebook.com/v24.0'
const account = { externalId: FB_PAGE, accessToken: 'EAAG' }
const adapter = createFacebookAdapter()

function capture(method: 'get' | 'post' | 'delete', url: string, response: Record<string, unknown>) {
  const calls: { body: unknown; search: URLSearchParams }[] = []
  server.use(
    http[method](url, async ({ request }) => {
      const text = await request.text()
      calls.push({ body: text ? JSON.parse(text) : null, search: new URL(request.url).searchParams })
      return HttpResponse.json(response)
    }),
  )
  return calls
}

describe('createFacebookAdapter', () => {
  it('normalizes Page webhooks and has no follow check', () => {
    expect(adapter.platform).toBe('facebook')
    expect(adapter.normalizeWebhook(fb.comment)).toHaveLength(1)
    expect(adapter.isFollower).toBeUndefined()
  })

  it('sends DMs as RESPONSE messages', async () => {
    const calls = capture('post', `${base}/${FB_PAGE}/messages`, { recipient_id: 'psid_1', message_id: 'm_out' })
    expect(await adapter.sendMessage(account, 'psid_1', { kind: 'text', text: 'Hi' })).toEqual({ messageId: 'm_out' })
    expect(calls[0]?.body).toEqual({ recipient: { id: 'psid_1' }, messaging_type: 'RESPONSE', message: { text: 'Hi' } })
  })

  it('sends private replies', async () => {
    const calls = capture('post', `${base}/${FB_PAGE}/messages`, { message_id: 'm_pr' })
    await adapter.sendPrivateReply(account, '104_c1', { kind: 'text', text: 'Hi' })
    expect(calls[0]?.body).toEqual({ recipient: { comment_id: '104_c1' }, message: { text: 'Hi' } })
  })

  it('replies publicly to comments', async () => {
    const calls = capture('post', `${base}/104_c1/comments`, { id: '104_c1_r' })
    expect(await adapter.replyToComment(account, '104_c1', 'Sent!')).toEqual({ messageId: '104_c1_r' })
    expect(calls[0]?.body).toEqual({ message: 'Sent!' })
  })

  it('reads profiles and post time', async () => {
    capture('get', `${base}/psid_1`, { name: 'Priya Sharma', profile_pic: 'https://pic' })
    capture('get', `${base}/104_p1`, { created_time: '2026-10-01T09:00:00+0000' })
    expect(await adapter.getProfile(account, 'psid_1')).toEqual({
      name: 'Priya Sharma',
      username: null,
      avatarUrl: 'https://pic',
    })
    expect((await adapter.getMediaPublishedAt(account, '104_p1'))?.toISOString()).toBe('2026-10-01T09:00:00.000Z')
  })

  it('sets and clears ice breakers', async () => {
    const posts = capture('post', `${base}/me/messenger_profile`, { result: 'success' })
    await adapter.setIceBreakers(account, [{ question: 'Hours?', payload: 'ib:a1:0' }])
    expect(posts[0]?.body).toEqual({
      ice_breakers: [{ locale: 'default', call_to_actions: [{ question: 'Hours?', payload: 'ib:a1:0' }] }],
    })
    const deletes = capture('delete', `${base}/me/messenger_profile`, { result: 'success' })
    await adapter.setIceBreakers(account, [])
    expect(deletes[0]?.body).toEqual({ fields: ['ice_breakers'] })
  })

  it('subscribes the Page', async () => {
    const calls = capture('post', `${base}/${FB_PAGE}/subscribed_apps`, { success: true })
    await adapter.subscribeWebhooks(account)
    expect(calls[0]?.search.get('subscribed_fields')).toBe('messages,messaging_postbacks,feed')
  })

  it('keeps non-expiring Page tokens', async () => {
    expect(await adapter.refreshToken(account)).toEqual({ accessToken: 'EAAG', expiresAt: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @replyooo/meta test facebook`
Expected: FAIL. `createFacebookAdapter` isn't exported yet.

- [ ] **Step 3: Implement**

`packages/meta/src/facebook.ts`:
```ts
import { GRAPH_API_VERSION, graphRequest } from './graph'
import { toGraphMessage } from './messages'
import { normalizeFacebookWebhook } from './normalize'
import type { AccountCredentials, PlatformAdapter } from './types'

export function createFacebookAdapter(options: { graphVersion?: string } = {}): PlatformAdapter {
  const baseUrl = `https://graph.facebook.com/${options.graphVersion ?? GRAPH_API_VERSION}`
  const call = <T>(
    account: AccountCredentials,
    path: string,
    init: { method?: 'GET' | 'POST' | 'DELETE'; query?: Record<string, string>; body?: unknown } = {},
  ) => graphRequest<T>({ baseUrl, path, token: account.accessToken, ...init })

  return {
    platform: 'facebook',
    normalizeWebhook: normalizeFacebookWebhook,

    async sendMessage(account, recipientId, message) {
      const res = await call<{ message_id?: string }>(account, `${account.externalId}/messages`, {
        method: 'POST',
        body: { recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: toGraphMessage(message) },
      })
      return { messageId: res.message_id ?? null }
    },

    async sendPrivateReply(account, commentId, message) {
      const res = await call<{ message_id?: string }>(account, `${account.externalId}/messages`, {
        method: 'POST',
        body: { recipient: { comment_id: commentId }, message: toGraphMessage(message) },
      })
      return { messageId: res.message_id ?? null }
    },

    async replyToComment(account, commentId, text) {
      const res = await call<{ id?: string }>(account, `${commentId}/comments`, {
        method: 'POST',
        body: { message: text },
      })
      return { messageId: res.id ?? null }
    },

    async getProfile(account, userId) {
      const res = await call<{ name?: string; profile_pic?: string }>(account, userId, {
        query: { fields: 'name,profile_pic' },
      })
      return { name: res.name ?? null, username: null, avatarUrl: res.profile_pic ?? null }
    },

    async getMediaPublishedAt(account, mediaId) {
      const res = await call<{ created_time?: string }>(account, mediaId, { query: { fields: 'created_time' } })
      return res.created_time ? new Date(res.created_time) : null
    },

    async setIceBreakers(account, items) {
      if (items.length === 0) {
        await call(account, 'me/messenger_profile', { method: 'DELETE', body: { fields: ['ice_breakers'] } })
        return
      }
      await call(account, 'me/messenger_profile', {
        method: 'POST',
        body: {
          ice_breakers: [
            { locale: 'default', call_to_actions: items.map((i) => ({ question: i.question, payload: i.payload })) },
          ],
        },
      })
    },

    async subscribeWebhooks(account) {
      await call(account, `${account.externalId}/subscribed_apps`, {
        method: 'POST',
        query: { subscribed_fields: 'messages,messaging_postbacks,feed' },
      })
    },

    async refreshToken(account) {
      return { accessToken: account.accessToken, expiresAt: null }
    },
  }
}
```

Append to `packages/meta/src/index.ts`:
```ts
export * from './facebook'
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @replyooo/meta test && pnpm --filter @replyooo/meta typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/meta
git commit -m "feat(meta): add Facebook adapter"
```

---

### Task 8: Worker scaffold, env, deps and test harness

**Files:**
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`, `apps/worker/vitest.config.ts`, `apps/worker/src/env.ts`, `apps/worker/src/logger.ts`, `apps/worker/src/deps.ts`, `apps/worker/test/global-setup.ts`, `apps/worker/test/support.ts`
- Modify: `.env.example`
- Test: `apps/worker/test/env.test.ts`, `apps/worker/test/harness.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface Env { DATABASE_URL; REDIS_URL; TOKEN_ENCRYPTION_KEY; META_APP_SECRET; INSTAGRAM_APP_SECRET;
                  META_WEBHOOK_VERIFY_TOKEN; META_GRAPH_VERSION; PORT; OUTBOUND_RATE_PER_SECOND; LOG_LEVEL }
  function loadEnv(source?: Record<string, string | undefined>): Env
  function createLogger(level: string): Logger

  type FlowJobData = { runId: string; event: EngineEvent; expectedVersion?: number }
  type FollowCheckJobData = { runId: string; expectedVersion: number }
  type OutboundJobData = { messageIds: string[] }
  interface Jobs {
    inbound(webhookEventId: string): Promise<void>
    flow(data: FlowJobData, opts?: { at?: Date; jobId?: string }): Promise<void>
    followCheck(data: FollowCheckJobData): Promise<void>
    outbound(data: OutboundJobData): Promise<void>
  }
  interface RateLimiter { /** 0 = go now, otherwise ms to wait. */ take(key: string): Promise<number> }
  interface Deps { db: Db; jobs: Jobs; adapters: Record<Platform, PlatformAdapter>; rateLimiter: RateLimiter;
                   tokenKey: Buffer; log: Logger; now: () => Date }
  ```
  Test support (`test/support.ts`): `useDb()`, `createTestContext()` → `{ deps, jobs: RecordingJobs, adapters: { instagram: FakeAdapter; facebook: FakeAdapter }, clock }`, and seed helpers `seedAccount`, `publishAutomation`, `seedContact`, `insertEvent`, plus event builders `dm`, `comment`, `postback`, `story`.

- [ ] **Step 1: Scaffold the app**

`apps/worker/package.json`:
```json
{
  "name": "@replyooo/worker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "start": "tsx src/main.ts",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@hono/node-server": "^2.1.3",
    "@replyooo/db": "workspace:*",
    "@replyooo/engine": "workspace:*",
    "@replyooo/meta": "workspace:*",
    "@replyooo/shared": "workspace:*",
    "bullmq": "^6.3.11",
    "drizzle-orm": "^0.45.3",
    "hono": "^4.13.13",
    "ioredis": "^6.0.0",
    "pino": "^10.4.0",
    "tsx": "^4.23.15",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@testcontainers/postgresql": "^12.2.0",
    "@testcontainers/redis": "^12.2.0",
    "@types/node": "^26.6.4",
    "msw": "^3.0.2",
    "typescript": "^7.0.2",
    "vitest": "^5.0.3"
  }
}
```

`apps/worker/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test", "vitest.config.ts"] }
```

`apps/worker/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    hookTimeout: 120_000,
    testTimeout: 30_000,
    // Test files share one database; the sweeper test scans global tables.
    fileParallelism: false,
  },
})
```

Append to `.env.example`:
```
# 32 random bytes, base64: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
TOKEN_ENCRYPTION_KEY=
META_APP_ID=
META_APP_SECRET=
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
META_WEBHOOK_VERIFY_TOKEN=
META_GRAPH_VERSION=v24.0
PORT=3001
OUTBOUND_RATE_PER_SECOND=10
LOG_LEVEL=info
```

Run: `pnpm install`
Expected: lockfile updated.

- [ ] **Step 2: Write env, logger and deps**

`apps/worker/src/env.ts`:
```ts
import { z } from 'zod'

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
  META_APP_SECRET: z.string().min(1),
  INSTAGRAM_APP_SECRET: z.string().min(1),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(1),
  META_GRAPH_VERSION: z.string().default('v24.0'),
  PORT: z.coerce.number().int().positive().default(3001),
  OUTBOUND_RATE_PER_SECOND: z.coerce.number().int().positive().default(10),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

export type Env = z.infer<typeof EnvSchema>

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return EnvSchema.parse(source)
}
```

`apps/worker/src/logger.ts`:
```ts
import { pino } from 'pino'

export type { Logger } from 'pino'

export function createLogger(level: string) {
  return pino({ level, base: { service: 'worker' } })
}
```

`apps/worker/src/deps.ts`:
```ts
import type { Db } from '@replyooo/db'
import type { EngineEvent } from '@replyooo/engine'
import type { PlatformAdapter } from '@replyooo/meta'
import type { Platform } from '@replyooo/shared'
import type { Logger } from './logger'

export interface FlowJobData {
  runId: string
  event: EngineEvent
  /** Required for timeouts and follow results; the job is a no-op if the run moved on. */
  expectedVersion?: number
}

export interface FollowCheckJobData {
  runId: string
  expectedVersion: number
}

export interface OutboundJobData {
  /** Sent in order, one Graph call each. */
  messageIds: string[]
}

export interface Jobs {
  inbound(webhookEventId: string): Promise<void>
  flow(data: FlowJobData, opts?: { at?: Date; jobId?: string }): Promise<void>
  followCheck(data: FollowCheckJobData): Promise<void>
  outbound(data: OutboundJobData): Promise<void>
}

export interface RateLimiter {
  /** Returns 0 when the call may go now, otherwise how many ms to wait. */
  take(key: string): Promise<number>
}

export interface Deps {
  db: Db
  jobs: Jobs
  adapters: Record<Platform, PlatformAdapter>
  rateLimiter: RateLimiter
  tokenKey: Buffer
  log: Logger
  now: () => Date
}
```

- [ ] **Step 3: Write the test harness**

`apps/worker/test/global-setup.ts`:
```ts
import { createDb } from '@replyooo/db'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer } from '@testcontainers/redis'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { fileURLToPath } from 'node:url'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string
    redisUrl: string
  }
}

export default async function setup(project: TestProject) {
  const postgres = await new PostgreSqlContainer('postgres:18-alpine').start()
  const redis = await new RedisContainer('redis:7-alpine').start()
  const databaseUrl = postgres.getConnectionUri()

  const { db, close } = createDb(databaseUrl)
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)),
  })
  await close()

  project.provide('databaseUrl', databaseUrl)
  project.provide('redisUrl', redis.getConnectionUrl())

  return async () => {
    await redis.stop()
    await postgres.stop()
  }
}
```

`apps/worker/test/support.ts`:
```ts
import type { Db } from '@replyooo/db'
import {
  automationVersions,
  automations,
  connectedAccounts,
  contacts,
  createDb,
  encryptToken,
  webhookEvents,
  workspaces,
} from '@replyooo/db'
import type {
  AccountCredentials,
  IceBreaker,
  MetaError,
  NormalizedEvent,
  PlatformAdapter,
  Profile,
  SendableMessage,
} from '@replyooo/meta'
import { normalizeFacebookWebhook, normalizeInstagramWebhook } from '@replyooo/meta'
import type { FlowDefinition, Platform } from '@replyooo/shared'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { pino } from 'pino'
import { afterAll, inject } from 'vitest'
import type { Deps, FlowJobData, FollowCheckJobData, Jobs, OutboundJobData, RateLimiter } from '../src/deps'

export const TOKEN_KEY = Buffer.alloc(32, 7)
export const NOW = new Date('2026-10-06T10:00:00.000Z')

// ---------- database ----------

let shared: { db: Db; close: () => Promise<void> } | undefined

/** One connection pool per test file, closed after the file. */
export function useDb(): Db {
  if (!shared) {
    shared = createDb(inject('databaseUrl'))
    afterAll(async () => {
      await shared?.close()
      shared = undefined
    })
  }
  return shared.db
}

// ---------- fakes ----------

export class RecordingJobs implements Jobs {
  inbounds: string[] = []
  flows: { data: FlowJobData; opts?: { at?: Date; jobId?: string } }[] = []
  followChecks: FollowCheckJobData[] = []
  outbounds: OutboundJobData[] = []

  async inbound(webhookEventId: string) {
    this.inbounds.push(webhookEventId)
  }
  async flow(data: FlowJobData, opts?: { at?: Date; jobId?: string }) {
    this.flows.push(opts ? { data, opts } : { data })
  }
  async followCheck(data: FollowCheckJobData) {
    this.followChecks.push(data)
  }
  async outbound(data: OutboundJobData) {
    this.outbounds.push(data)
  }
  clear() {
    this.inbounds = []
    this.flows = []
    this.followChecks = []
    this.outbounds = []
  }
}

export interface FakeCall {
  method: string
  args: unknown[]
}

export class FakeAdapter implements PlatformAdapter {
  calls: FakeCall[] = []
  /** Thrown, in order, by the next send/reply/follow calls. */
  errors: MetaError[] = []
  following = false
  profile: Profile = { name: 'Priya Sharma', username: 'priya', avatarUrl: null }
  mediaPublishedAt: Date | null = null
  private counter = 0

  constructor(readonly platform: Platform) {}

  normalizeWebhook(payload: unknown): NormalizedEvent[] {
    return this.platform === 'instagram' ? normalizeInstagramWebhook(payload) : normalizeFacebookWebhook(payload)
  }

  private act(method: string, args: unknown[]) {
    this.calls.push({ method, args })
    const error = this.errors.shift()
    if (error) throw error
    return { messageId: `${method}-${++this.counter}` }
  }

  async sendMessage(_: AccountCredentials, recipientId: string, message: SendableMessage) {
    return this.act('sendMessage', [recipientId, message])
  }
  async sendPrivateReply(_: AccountCredentials, commentId: string, message: SendableMessage) {
    return this.act('sendPrivateReply', [commentId, message])
  }
  async replyToComment(_: AccountCredentials, commentId: string, text: string) {
    return this.act('replyToComment', [commentId, text])
  }
  async getProfile(_: AccountCredentials, userId: string) {
    this.calls.push({ method: 'getProfile', args: [userId] })
    return this.profile
  }
  async getMediaPublishedAt(_: AccountCredentials, mediaId: string) {
    this.calls.push({ method: 'getMediaPublishedAt', args: [mediaId] })
    return this.mediaPublishedAt
  }
  async isFollower(_: AccountCredentials, userId: string) {
    this.act('isFollower', [userId])
    return this.following
  }
  async setIceBreakers(_: AccountCredentials, items: IceBreaker[]) {
    this.calls.push({ method: 'setIceBreakers', args: [items] })
  }
  async subscribeWebhooks() {
    this.calls.push({ method: 'subscribeWebhooks', args: [] })
  }
  async refreshToken(account: AccountCredentials) {
    this.act('refreshToken', [])
    return { accessToken: `${account.accessToken}-refreshed`, expiresAt: new Date(NOW.getTime() + 60 * 86_400_000) }
  }

  sent(method?: string): FakeCall[] {
    return method ? this.calls.filter((c) => c.method === method) : this.calls
  }
}

export const allowAll: RateLimiter = { take: async () => 0 }

export interface TestContext {
  deps: Deps
  jobs: RecordingJobs
  adapters: { instagram: FakeAdapter; facebook: FakeAdapter }
  clock: { now: Date }
}

export function createTestContext(overrides: Partial<Deps> = {}): TestContext {
  const jobs = new RecordingJobs()
  const adapters = { instagram: new FakeAdapter('instagram'), facebook: new FakeAdapter('facebook') }
  const clock = { now: NOW }
  const deps: Deps = {
    db: useDb(),
    jobs,
    adapters,
    rateLimiter: allowAll,
    tokenKey: TOKEN_KEY,
    log: pino({ level: 'silent' }),
    now: () => clock.now,
    ...overrides,
  }
  return { deps, jobs, adapters, clock }
}

// ---------- seeding ----------

export async function seedAccount(db: Db, opts: { platform?: Platform; tokenExpiresAt?: Date | null } = {}) {
  const [workspace] = await db.insert(workspaces).values({ name: 'Acme', ownerUserId: 'user_1' }).returning()
  const platform = opts.platform ?? 'instagram'
  const [account] = await db
    .insert(connectedAccounts)
    .values({
      workspaceId: workspace!.id,
      platform,
      externalId: `${platform}_${randomUUID()}`,
      username: 'acme',
      accessTokenEnc: encryptToken('token-abc', TOKEN_KEY),
      tokenExpiresAt: opts.tokenExpiresAt ?? null,
    })
    .returning()
  return { workspace: workspace!, account: account! }
}

export type AccountRow = Awaited<ReturnType<typeof seedAccount>>['account']

export async function publishAutomation(
  db: Db,
  account: AccountRow,
  definition: FlowDefinition,
  opts: { publishedAt?: Date; pinnedMediaId?: string } = {},
) {
  const [automation] = await db
    .insert(automations)
    .values({
      workspaceId: account.workspaceId,
      connectedAccountId: account.id,
      name: 'Test automation',
      status: 'active',
      triggerType: definition.trigger.type,
      definition,
      pinnedMediaId: opts.pinnedMediaId ?? null,
    })
    .returning()
  const [version] = await db
    .insert(automationVersions)
    .values({ automationId: automation!.id, version: 1, definition, publishedAt: opts.publishedAt ?? NOW })
    .returning()
  await db.update(automations).set({ currentVersionId: version!.id }).where(eq(automations.id, automation!.id))
  return { automation: automation!, version: version! }
}

export async function seedContact(
  db: Db,
  account: AccountRow,
  values: Partial<typeof contacts.$inferInsert> = {},
) {
  const [contact] = await db
    .insert(contacts)
    .values({
      workspaceId: account.workspaceId,
      connectedAccountId: account.id,
      platformUserId: `user_${randomUUID()}`,
      lastInboundAt: NOW,
      ...values,
    })
    .returning()
  return contact!
}

export async function insertEvent(db: Db, event: NormalizedEvent): Promise<string> {
  const [row] = await db
    .insert(webhookEvents)
    .values({ platform: event.platform, dedupKey: event.dedupKey, payload: event })
    .returning({ id: webhookEvents.id })
  return row!.id
}

// ---------- normalized event builders ----------

const base = (account: AccountRow, senderId: string) => ({
  platform: account.platform,
  accountExternalId: account.externalId,
  senderId,
  occurredAt: NOW.toISOString(),
})

export const dm = (account: AccountRow, senderId: string, text: string | null): NormalizedEvent => {
  const id = randomUUID()
  return { ...base(account, senderId), type: 'dm_received', dedupKey: `t:${id}`, messageId: id, text }
}

export const story = (account: AccountRow, senderId: string, text: string | null, isReaction = false): NormalizedEvent => {
  const id = randomUUID()
  return { ...base(account, senderId), type: 'story_reply', dedupKey: `t:${id}`, messageId: id, text, isReaction }
}

export const postback = (account: AccountRow, senderId: string, payload: string): NormalizedEvent => {
  const id = randomUUID()
  return { ...base(account, senderId), type: 'postback', dedupKey: `t:${id}`, messageId: id, payload, title: null }
}

export const comment = (
  account: AccountRow,
  senderId: string,
  text: string,
  opts: { mediaId?: string; commentId?: string } = {},
): NormalizedEvent => {
  const commentId = opts.commentId ?? `c_${randomUUID()}`
  return {
    ...base(account, senderId),
    type: 'comment_created',
    dedupKey: `t:${commentId}`,
    commentId,
    mediaId: opts.mediaId ?? 'media1',
    text,
    senderUsername: 'priya',
    senderName: null,
  }
}
```

- [ ] **Step 4: Write the tests**

`apps/worker/test/env.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { loadEnv } from '../src/env'

const required = {
  DATABASE_URL: 'postgres://x',
  REDIS_URL: 'redis://x',
  TOKEN_ENCRYPTION_KEY: 'a2V5',
  META_APP_SECRET: 's1',
  INSTAGRAM_APP_SECRET: 's2',
  META_WEBHOOK_VERIFY_TOKEN: 'v',
}

describe('loadEnv', () => {
  it('applies defaults', () => {
    expect(loadEnv(required)).toMatchObject({
      META_GRAPH_VERSION: 'v24.0',
      PORT: 3001,
      OUTBOUND_RATE_PER_SECOND: 10,
      LOG_LEVEL: 'info',
    })
  })

  it('coerces numbers and rejects missing secrets', () => {
    expect(loadEnv({ ...required, PORT: '8080' }).PORT).toBe(8080)
    expect(() => loadEnv({ ...required, META_APP_SECRET: undefined })).toThrow()
  })
})
```

`apps/worker/test/harness.test.ts`:
```ts
import { decryptToken } from '@replyooo/db'
import { describe, expect, it } from 'vitest'
import { publishAutomation, seedAccount, seedContact, TOKEN_KEY, useDb } from './support'

describe('test harness', () => {
  it('seeds an account, contact and published automation against the migrated database', async () => {
    const db = useDb()
    const { account } = await seedAccount(db)
    expect(decryptToken(account.accessTokenEnc, TOKEN_KEY)).toBe('token-abc')
    const contact = await seedContact(db, account)
    expect(contact.lastCountedPeriod).toBeNull()
    const { automation, version } = await publishAutomation(db, account, {
      trigger: { type: 'any_dm' },
      start: 's1',
      steps: { s1: { type: 'send_message', text: 'hi' } },
    })
    expect(version.automationId).toBe(automation.id)
  })
})
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @replyooo/worker test && pnpm --filter @replyooo/worker typecheck`
Expected: PASS (Docker must be running).

- [ ] **Step 6: Commit**

```bash
git add apps/worker .env.example pnpm-lock.yaml
git commit -m "chore(worker): scaffold worker app, env, deps and test harness"
```

---

### Task 9: Worker: record helpers (row ↔ engine mapping)

**Files:**
- Create: `apps/worker/src/records.ts`
- Test: `apps/worker/test/records.test.ts`

**Interfaces:**
- Consumes: `FlowRunState`, `ContactState`, `Effect`, `Wait` from `@replyooo/engine`. Tables from `@replyooo/db`.
- Produces:
  ```ts
  type FlowRunRow = typeof flowRuns.$inferSelect
  type ContactRow = typeof contacts.$inferSelect
  type AccountRow = typeof connectedAccounts.$inferSelect
  function toRunState(row: FlowRunRow): FlowRunState
  function runColumns(state: FlowRunState, now: Date): Partial<typeof flowRuns.$inferInsert>
  function toContactState(row: ContactRow): ContactState
  function applyContactEffects(contact: ContactRow, effects: Effect[]): Pick<ContactRow, 'email'|'phone'|'tags'|'fields'> | null
  function credentials(account: AccountRow, key: Buffer): AccountCredentials
  function endRun(db: Db | Tx, runId: string, status: 'failed' | 'expired', error: string, now: Date): Promise<void>
  function markReauthRequired(db: Db | Tx, accountId: string): Promise<void>
  ```

- [ ] **Step 1: Write the failing test**

`apps/worker/test/records.test.ts`:
```ts
import { flowRuns } from '@replyooo/db'
import type { Effect } from '@replyooo/engine'
import { newRunState } from '@replyooo/engine'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { applyContactEffects, credentials, endRun, runColumns, toRunState } from '../src/records'
import { NOW, publishAutomation, seedAccount, seedContact, TOKEN_KEY, useDb } from './support'

describe('record helpers', () => {
  it('round-trips run state through a row', async () => {
    const db = useDb()
    const { account } = await seedAccount(db)
    const contact = await seedContact(db, account)
    const { automation, version } = await publishAutomation(db, account, {
      trigger: { type: 'any_dm' },
      start: 's1',
      steps: { s1: { type: 'delay', minutes: 5 } },
    })
    const state = {
      ...newRunState(),
      status: 'waiting' as const,
      currentStepId: 's1',
      wait: { kind: 'reply' as const, attempts: 1 },
      waitUntil: new Date(NOW.getTime() + 60_000),
      vars: { email: 'a@b.co' },
      stateVersion: 3,
      outbound: 'blocked' as const,
      commentId: 'c1',
    }
    const [row] = await db
      .insert(flowRuns)
      .values({
        automationId: automation.id,
        automationVersionId: version.id,
        contactId: contact.id,
        connectedAccountId: account.id,
        ...runColumns(state, NOW),
      })
      .returning()
    expect(toRunState(row!)).toEqual(state)
    expect(row!.completedAt).toBeNull()

    const done = runColumns({ ...state, status: 'completed', wait: null, waitUntil: null }, NOW)
    expect(done.completedAt).toEqual(NOW)

    await endRun(db, row!.id, 'expired', 'window_closed', NOW)
    const [ended] = await db.select().from(flowRuns).where(eq(flowRuns.id, row!.id))
    expect(ended).toMatchObject({ status: 'expired', error: 'window_closed', wait: null, stateVersion: 4 })

    await endRun(db, row!.id, 'failed', 'again', NOW)
    const [unchanged] = await db.select().from(flowRuns).where(eq(flowRuns.id, row!.id))
    expect(unchanged).toMatchObject({ status: 'expired', stateVersion: 4 })
  })

  it('applies contact patches in order', () => {
    const contact = {
      email: null,
      phone: null,
      tags: ['old', 'vip'],
      fields: { city: 'Pune' },
    } as unknown as Parameters<typeof applyContactEffects>[0]
    const effects: Effect[] = [
      { type: 'send', message: { text: 'x' } },
      { type: 'update_contact', patch: { email: 'a@b.co', fields: { size: 'M' } } },
      { type: 'update_contact', patch: { addTags: ['lead', 'vip'], removeTags: ['old'] } },
    ]
    expect(applyContactEffects(contact, effects)).toEqual({
      email: 'a@b.co',
      phone: null,
      tags: ['vip', 'lead'],
      fields: { city: 'Pune', size: 'M' },
    })
    expect(applyContactEffects(contact, [{ type: 'check_follow' }])).toBeNull()
  })

  it('decrypts account credentials', async () => {
    const { account } = await seedAccount(useDb())
    expect(credentials(account, TOKEN_KEY)).toEqual({ externalId: account.externalId, accessToken: 'token-abc' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @replyooo/worker test records`
Expected: FAIL. `../src/records` doesn't exist yet.

- [ ] **Step 3: Implement**

`apps/worker/src/records.ts`:
```ts
import type { Db, Tx } from '@replyooo/db'
import { connectedAccounts, type contacts, decryptToken, flowRuns } from '@replyooo/db'
import type { ContactState, Effect, FlowRunState, RunStatus, Wait } from '@replyooo/engine'
import type { AccountCredentials } from '@replyooo/meta'
import { and, eq, inArray, sql } from 'drizzle-orm'

export type FlowRunRow = typeof flowRuns.$inferSelect
export type ContactRow = typeof contacts.$inferSelect
export type AccountRow = typeof connectedAccounts.$inferSelect

const FINAL: ReadonlySet<RunStatus> = new Set(['completed', 'failed', 'expired', 'cancelled'])

export function toRunState(row: FlowRunRow): FlowRunState {
  return {
    status: row.status,
    currentStepId: row.currentStepId,
    wait: row.wait as Wait | null,
    waitUntil: row.waitUntil,
    vars: row.vars,
    stateVersion: row.stateVersion,
    outbound: row.outbound,
    commentId: row.commentId,
    error: row.error,
  }
}

export function runColumns(state: FlowRunState, now: Date) {
  return {
    status: state.status,
    currentStepId: state.currentStepId,
    wait: state.wait as Record<string, unknown> | null,
    waitUntil: state.waitUntil,
    vars: state.vars,
    stateVersion: state.stateVersion,
    outbound: state.outbound,
    commentId: state.commentId,
    error: state.error,
    completedAt: FINAL.has(state.status) ? now : null,
  } satisfies Partial<typeof flowRuns.$inferInsert>
}

export function toContactState(row: ContactRow): ContactState {
  return {
    username: row.username,
    name: row.name,
    email: row.email,
    phone: row.phone,
    tags: row.tags,
    fields: row.fields,
  }
}

/** Folds the engine's `update_contact` effects into new column values (same order as the engine). */
export function applyContactEffects(
  contact: ContactRow,
  effects: readonly Effect[],
): Pick<ContactRow, 'email' | 'phone' | 'tags' | 'fields'> | null {
  let { email, phone, tags, fields } = contact
  let changed = false
  for (const effect of effects) {
    if (effect.type !== 'update_contact') continue
    changed = true
    const { patch } = effect
    if (patch.email !== undefined) email = patch.email
    if (patch.phone !== undefined) phone = patch.phone
    if (patch.fields) fields = { ...fields, ...patch.fields }
    if (patch.removeTags) {
      const remove = patch.removeTags
      tags = tags.filter((tag) => !remove.includes(tag))
    }
    if (patch.addTags) tags = [...new Set([...tags, ...patch.addTags])]
  }
  return changed ? { email, phone, tags, fields } : null
}

export function credentials(account: AccountRow, key: Buffer): AccountCredentials {
  return { externalId: account.externalId, accessToken: decryptToken(account.accessTokenEnc, key) }
}

/** Ends a live run from outside the engine (send failures, reauth). Bumps the version so pending jobs no-op. */
export async function endRun(
  db: Db | Tx,
  runId: string,
  status: 'failed' | 'expired',
  error: string,
  now: Date,
): Promise<void> {
  await db
    .update(flowRuns)
    .set({
      status,
      error,
      wait: null,
      waitUntil: null,
      completedAt: now,
      stateVersion: sql`${flowRuns.stateVersion} + 1`,
    })
    .where(and(eq(flowRuns.id, runId), inArray(flowRuns.status, ['running', 'waiting'])))
}

export async function markReauthRequired(db: Db | Tx, accountId: string): Promise<void> {
  await db.update(connectedAccounts).set({ status: 'reauth_required' }).where(eq(connectedAccounts.id, accountId))
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @replyooo/worker test records && pnpm --filter @replyooo/worker typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): add run/contact record mapping helpers"
```

---

### Task 10: Worker: webhook ingestion + Hono server

**Files:**
- Create: `apps/worker/src/webhooks.ts`, `apps/worker/src/server.ts`
- Test: `apps/worker/test/server.test.ts`

**Interfaces:**
- Produces:
  ```ts
  function verifySignature(rawBody: Buffer, header: string | undefined, secrets: readonly string[]): boolean
  function platformForObject(object: unknown): Platform | null       // 'instagram' → instagram, 'page' → facebook
  function ingestWebhook(deps: Deps, body: unknown): Promise<{ stored: number; duplicates: number }>
  interface ServerConfig { verifyToken: string; appSecrets: string[] }
  function createServer(deps: Deps, config: ServerConfig): Hono
  ```
  Routes: `GET /health`. `GET /webhooks/meta` (subscription handshake: echoes `hub.challenge` when `hub.mode=subscribe` and the token matches, otherwise 403). `POST /webhooks/meta`: 401 on a bad signature, 400 on bad JSON, 500 if storage fails (Meta retries), otherwise 200 `EVENT_RECEIVED`. Ingestion inserts one `webhook_events` row per normalized event with `ON CONFLICT (dedup_key) DO NOTHING` and enqueues `inbound` only for newly inserted rows.

- [ ] **Step 1: Write the failing test**

`apps/worker/test/server.test.ts`:
```ts
import { webhookEvents } from '@replyooo/db'
import { inArray } from 'drizzle-orm'
import { createHmac, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createServer } from '../src/server'
import { verifySignature } from '../src/webhooks'
import { createTestContext } from './support'

const config = { verifyToken: 'verify-me', appSecrets: ['fb-secret', 'ig-secret'] }
const sign = (body: string, secret = 'ig-secret') =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

function igDmPayload(mids: string[]) {
  return JSON.stringify({
    object: 'instagram',
    entry: [
      {
        id: 'ig_acct',
        time: 1791280800000,
        messaging: mids.map((mid) => ({
          sender: { id: 'igsid_1' },
          recipient: { id: 'ig_acct' },
          timestamp: 1791280800000,
          message: { mid, text: 'hi' },
        })),
      },
    ],
  })
}

describe('verifySignature', () => {
  const body = Buffer.from('{"a":1}')
  it('accepts either configured secret', () => {
    expect(verifySignature(body, sign('{"a":1}', 'fb-secret'), config.appSecrets)).toBe(true)
    expect(verifySignature(body, sign('{"a":1}', 'ig-secret'), config.appSecrets)).toBe(true)
  })
  it('rejects wrong, missing and malformed signatures', () => {
    expect(verifySignature(body, sign('{"a":1}', 'other'), config.appSecrets)).toBe(false)
    expect(verifySignature(body, undefined, config.appSecrets)).toBe(false)
    expect(verifySignature(body, 'sha256=abc', config.appSecrets)).toBe(false)
    expect(verifySignature(body, 'md5=abc', config.appSecrets)).toBe(false)
  })
})

describe('webhook server', () => {
  it('answers the subscription handshake', async () => {
    const app = createServer(createTestContext().deps, config)
    const ok = await app.request('/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42')
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe('42')
    const bad = await app.request('/webhooks/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42')
    expect(bad.status).toBe(403)
    expect((await app.request('/health')).status).toBe(200)
  })

  it('rejects bad signatures and bad JSON', async () => {
    const { deps, jobs } = createTestContext()
    const app = createServer(deps, config)
    const body = igDmPayload([`mid.${randomUUID()}`])
    const unsigned = await app.request('/webhooks/meta', { method: 'POST', body })
    expect(unsigned.status).toBe(401)
    const badJson = await app.request('/webhooks/meta', {
      method: 'POST',
      body: '{nope',
      headers: { 'x-hub-signature-256': sign('{nope') },
    })
    expect(badJson.status).toBe(400)
    expect(jobs.inbounds).toEqual([])
  })

  it('stores each event and enqueues inbound jobs', async () => {
    const { deps, jobs } = createTestContext()
    const app = createServer(deps, config)
    const mids = [`mid.${randomUUID()}`, `mid.${randomUUID()}`]
    const body = igDmPayload(mids)
    const res = await app.request('/webhooks/meta', {
      method: 'POST',
      body,
      headers: { 'x-hub-signature-256': sign(body), 'content-type': 'application/json' },
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('EVENT_RECEIVED')
    const rows = await deps.db
      .select()
      .from(webhookEvents)
      .where(inArray(webhookEvents.dedupKey, mids.map((m) => `instagram:message:${m}`)))
    expect(rows).toHaveLength(2)
    expect(jobs.inbounds.sort()).toEqual(rows.map((r) => r.id).sort())
  })

  it('stores duplicate deliveries once', async () => {
    const { deps, jobs } = createTestContext()
    const app = createServer(deps, config)
    const mid = `mid.${randomUUID()}`
    const body = igDmPayload([mid, mid])
    const send = () =>
      app.request('/webhooks/meta', { method: 'POST', body, headers: { 'x-hub-signature-256': sign(body) } })
    expect((await send()).status).toBe(200)
    expect((await send()).status).toBe(200)
    const rows = await deps.db
      .select()
      .from(webhookEvents)
      .where(inArray(webhookEvents.dedupKey, [`instagram:message:${mid}`]))
    expect(rows).toHaveLength(1)
    expect(jobs.inbounds).toEqual([rows[0]!.id])
  })

  it('acknowledges payloads it does not handle', async () => {
    const { deps, jobs } = createTestContext()
    const app = createServer(deps, config)
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] })
    const res = await app.request('/webhooks/meta', {
      method: 'POST',
      body,
      headers: { 'x-hub-signature-256': sign(body) },
    })
    expect(res.status).toBe(200)
    expect(jobs.inbounds).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @replyooo/worker test server`
Expected: FAIL. `../src/server` doesn't exist yet.

- [ ] **Step 3: Implement**

`apps/worker/src/webhooks.ts`:
```ts
import { webhookEvents } from '@replyooo/db'
import type { Platform } from '@replyooo/shared'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Deps } from './deps'

export function verifySignature(rawBody: Buffer, header: string | undefined, secrets: readonly string[]): boolean {
  if (!header?.startsWith('sha256=')) return false
  const received = Buffer.from(header.slice('sha256='.length), 'hex')
  return secrets.some((secret) => {
    const expected = createHmac('sha256', secret).update(rawBody).digest()
    return expected.length === received.length && timingSafeEqual(expected, received)
  })
}

export function platformForObject(object: unknown): Platform | null {
  if (object === 'instagram') return 'instagram'
  if (object === 'page') return 'facebook'
  return null
}

export async function ingestWebhook(deps: Deps, body: unknown): Promise<{ stored: number; duplicates: number }> {
  const object = body !== null && typeof body === 'object' ? (body as { object?: unknown }).object : undefined
  const platform = platformForObject(object)
  if (!platform) return { stored: 0, duplicates: 0 }
  const events = deps.adapters[platform].normalizeWebhook(body)
  if (events.length === 0) return { stored: 0, duplicates: 0 }

  const rows = await deps.db
    .insert(webhookEvents)
    .values(events.map((event) => ({ platform, dedupKey: event.dedupKey, payload: event })))
    .onConflictDoNothing({ target: webhookEvents.dedupKey })
    .returning({ id: webhookEvents.id })
  for (const row of rows) await deps.jobs.inbound(row.id)
  return { stored: rows.length, duplicates: events.length - rows.length }
}
```

`apps/worker/src/server.ts`:
```ts
import { Hono } from 'hono'
import type { Deps } from './deps'
import { ingestWebhook, verifySignature } from './webhooks'

export interface ServerConfig {
  verifyToken: string
  appSecrets: string[]
}

export function createServer(deps: Deps, config: ServerConfig): Hono {
  const app = new Hono()

  app.get('/health', (c) => c.json({ ok: true }))

  app.get('/webhooks/meta', (c) => {
    const challenge = c.req.query('hub.challenge')
    if (c.req.query('hub.mode') === 'subscribe' && c.req.query('hub.verify_token') === config.verifyToken && challenge) {
      return c.text(challenge)
    }
    return c.text('Forbidden', 403)
  })

  app.post('/webhooks/meta', async (c) => {
    const raw = Buffer.from(await c.req.arrayBuffer())
    if (!verifySignature(raw, c.req.header('x-hub-signature-256'), config.appSecrets)) {
      return c.text('Invalid signature', 401)
    }
    let body: unknown
    try {
      body = JSON.parse(raw.toString('utf8'))
    } catch {
      return c.text('Invalid JSON', 400)
    }
    try {
      const result = await ingestWebhook(deps, body)
      deps.log.debug(result, 'webhook ingested')
    } catch (error) {
      deps.log.error({ err: error }, 'webhook ingestion failed')
      return c.text('Retry later', 500)
    }
    return c.text('EVENT_RECEIVED')
  })

  return app
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @replyooo/worker test server && pnpm --filter @replyooo/worker typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): add Meta webhook ingestion server"
```

---

### Task 11: Worker: inbound route decision (pure)

**Files:**
- Create: `apps/worker/src/route.ts`
- Test: `apps/worker/test/route.test.ts`

**Interfaces:**
- Consumes: `advance`, `matchAutomation`, `TriggerCandidate`, `StartTrigger`, `EngineEvent` from `@replyooo/engine`. `decodePostback` from `@replyooo/shared`. `NormalizedEvent` from `@replyooo/meta`.
- Produces:
  ```ts
  interface WaitingRun { id: string; run: FlowRunState; flow: FlowDefinition }
  interface RouteInput { event: NormalizedEvent; contact: ContactState; waitingRun: WaitingRun | null;
                         candidates: readonly TriggerCandidate[]; mediaPublishedAt: Date | null; now: Date }
  type Route =
    | { kind: 'resume'; runId: string; event: EngineEvent }
    | { kind: 'start'; automationId: string; trigger: StartTrigger }
    | { kind: 'ignore'; reason: string }
  function decideRoute(input: RouteInput): Route
  ```
  Rules:
  1. `postback` with `r:` payload → resume that run with a `postback` event (the inbound handler checks the run belongs to the contact). `ib:` payload → start the ice-breaker automation at that item if it's an active candidate. Anything else → ignore.
  2. `comment_created` → `matchAutomation` comment → start with a `comment` trigger.
  3. `dm_received` / `story_reply` with text and a waiting run: if a dry-run `advance` with a `reply` event isn't `ignored`, resume with that reply.
  4. Otherwise match triggers (DM or story rules from Plan 1's router). With a waiting run, an `any_dm` match is ignored (`waiting_run_has_priority`). Keyword and story matches start a new run.

- [ ] **Step 1: Write the failing test**

`apps/worker/test/route.test.ts`:
```ts
import type { ContactState, FlowRunState, TriggerCandidate } from '@replyooo/engine'
import { newRunState } from '@replyooo/engine'
import type { NormalizedEvent } from '@replyooo/meta'
import type { FlowDefinition, Trigger } from '@replyooo/shared'
import { describe, expect, it } from 'vitest'
import type { RouteInput, WaitingRun } from '../src/route'
import { decideRoute } from '../src/route'

const NOW = new Date('2026-10-06T10:00:00Z')
const contact: ContactState = { username: null, name: null, email: null, phone: null, tags: [], fields: {} }
const base = { platform: 'instagram' as const, accountExternalId: 'acct', senderId: 'u1', occurredAt: NOW.toISOString() }

const dm = (text: string | null): NormalizedEvent => ({ ...base, type: 'dm_received', dedupKey: 'd', messageId: 'm', text })
const story = (text: string | null, isReaction: boolean): NormalizedEvent => ({
  ...base,
  type: 'story_reply',
  dedupKey: 'd',
  messageId: 'm',
  text,
  isReaction,
})
const postback = (payload: string): NormalizedEvent => ({
  ...base,
  type: 'postback',
  dedupKey: 'd',
  messageId: 'm',
  payload,
  title: null,
})
const comment = (text: string): NormalizedEvent => ({
  ...base,
  type: 'comment_created',
  dedupKey: 'd',
  commentId: 'c1',
  mediaId: 'media1',
  text,
  senderUsername: 'priya',
  senderName: null,
})

const candidate = (automationId: string, trigger: Trigger): TriggerCandidate => ({
  automationId,
  publishedAt: NOW,
  trigger,
})
const anyDm = candidate('any', { type: 'any_dm' })
const priceKeyword = candidate('price', { type: 'dm_keyword', keywords: ['price'], match: 'contains' })
const guideComment = candidate('guide', {
  type: 'comment_keyword',
  posts: { mode: 'any' },
  keywords: ['guide'],
  match: 'contains',
})
const iceBreaker = candidate('ib', {
  type: 'ice_breaker',
  items: [
    { question: 'Pricing?', startStep: 's1' },
    { question: 'Hours?', startStep: 's1' },
  ],
})
const storyReactions = candidate('story', { type: 'story_reply', includeReactions: true })

const waiting = (flow: FlowDefinition, state: Partial<FlowRunState>): WaitingRun => ({
  id: 'run1',
  flow,
  run: { ...newRunState(), status: 'waiting', stateVersion: 1, ...state },
})

const askEmail = waiting(
  {
    trigger: { type: 'dm_keyword', keywords: ['guide'], match: 'contains' },
    start: 'ask',
    steps: {
      ask: {
        type: 'ask',
        question: 'Email?',
        saveTo: 'email',
        validate: 'email',
        retryText: 'Try again',
        maxAttempts: 2,
        timeoutMinutes: 1440,
      },
    },
  },
  { currentStepId: 'ask', wait: { kind: 'reply', attempts: 0 }, waitUntil: new Date(NOW.getTime() + 86_400_000) },
)

const inDelay = waiting(
  { trigger: { type: 'any_dm' }, start: 'd', steps: { d: { type: 'delay', minutes: 60 } } },
  { currentStepId: 'd', wait: { kind: 'delay' }, waitUntil: new Date(NOW.getTime() + 3_600_000) },
)

const buttonWait = waiting(
  {
    trigger: { type: 'any_dm' },
    start: 's1',
    steps: {
      s1: {
        type: 'send_message',
        text: 'Want it?',
        buttons: [{ type: 'reply', id: 'yes', label: 'Send it', next: 's2' }],
      },
      s2: { type: 'send_message', text: 'Here' },
    },
  },
  { currentStepId: 's1', wait: { kind: 'postback' }, waitUntil: new Date(NOW.getTime() + 86_400_000) },
)

const route = (input: Partial<RouteInput> & Pick<RouteInput, 'event'>) =>
  decideRoute({ contact, waitingRun: null, candidates: [], mediaPublishedAt: null, now: NOW, ...input })

describe('decideRoute', () => {
  it('starts comment automations on matching comments', () => {
    expect(route({ event: comment('GUIDE pls'), candidates: [guideComment, anyDm] })).toEqual({
      kind: 'start',
      automationId: 'guide',
      trigger: { kind: 'comment', commentId: 'c1', text: 'GUIDE pls' },
    })
    expect(route({ event: comment('nice'), candidates: [guideComment] })).toMatchObject({ kind: 'ignore' })
  })

  it('starts DM automations by keyword, falling back to any_dm', () => {
    expect(route({ event: dm('price?'), candidates: [anyDm, priceKeyword] })).toMatchObject({
      kind: 'start',
      automationId: 'price',
      trigger: { kind: 'dm', text: 'price?' },
    })
    expect(route({ event: dm(null), candidates: [anyDm] })).toMatchObject({
      kind: 'start',
      automationId: 'any',
      trigger: { kind: 'dm', text: '' },
    })
    expect(route({ event: dm('hello'), candidates: [priceKeyword] })).toMatchObject({ kind: 'ignore' })
  })

  it('a valid answer resumes the waiting run even when any_dm matches', () => {
    expect(route({ event: dm("it's PRIYA@Gmail.com"), waitingRun: askEmail, candidates: [anyDm] })).toEqual({
      kind: 'resume',
      runId: 'run1',
      event: { type: 'reply', text: "it's PRIYA@Gmail.com" },
    })
  })

  it('an invalid answer still goes to the ask step (it re-asks)', () => {
    expect(route({ event: dm('no thanks'), waitingRun: askEmail, candidates: [anyDm] })).toMatchObject({
      kind: 'resume',
      runId: 'run1',
    })
  })

  it('typing a button label resumes a button wait', () => {
    expect(route({ event: dm('send it'), waitingRun: buttonWait, candidates: [anyDm] })).toMatchObject({
      kind: 'resume',
      event: { type: 'reply', text: 'send it' },
    })
  })

  it('a waiting run blocks any_dm but not keyword automations', () => {
    expect(route({ event: dm('hello'), waitingRun: inDelay, candidates: [anyDm] })).toEqual({
      kind: 'ignore',
      reason: 'waiting_run_has_priority',
    })
    expect(route({ event: dm('price'), waitingRun: inDelay, candidates: [anyDm, priceKeyword] })).toMatchObject({
      kind: 'start',
      automationId: 'price',
    })
  })

  it('routes flow button postbacks to their run', () => {
    expect(route({ event: postback('r:run9:s1:yes') })).toEqual({
      kind: 'resume',
      runId: 'run9',
      event: { type: 'postback', stepId: 's1', buttonId: 'yes' },
    })
  })

  it('starts ice breakers and ignores unknown postbacks', () => {
    expect(route({ event: postback('ib:ib:1'), candidates: [iceBreaker] })).toEqual({
      kind: 'start',
      automationId: 'ib',
      trigger: { kind: 'ice_breaker', itemIndex: 1 },
    })
    expect(route({ event: postback('ib:ib:7'), candidates: [iceBreaker] })).toMatchObject({ kind: 'ignore' })
    expect(route({ event: postback('ib:gone:0'), candidates: [iceBreaker] })).toMatchObject({ kind: 'ignore' })
    expect(route({ event: postback('GET_STARTED') })).toMatchObject({ kind: 'ignore' })
  })

  it('starts story automations for reactions', () => {
    expect(route({ event: story('🔥', true), candidates: [storyReactions, anyDm] })).toEqual({
      kind: 'start',
      automationId: 'story',
      trigger: { kind: 'story', text: '🔥' },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @replyooo/worker test route`
Expected: FAIL. `../src/route` doesn't exist yet.

- [ ] **Step 3: Implement**

`apps/worker/src/route.ts`:
```ts
import type {
  ContactState,
  EngineEvent,
  FlowRunState,
  StartTrigger,
  TriggerCandidate,
} from '@replyooo/engine'
import { advance, matchAutomation } from '@replyooo/engine'
import type { NormalizedEvent } from '@replyooo/meta'
import type { FlowDefinition } from '@replyooo/shared'
import { decodePostback } from '@replyooo/shared'

export interface WaitingRun {
  id: string
  run: FlowRunState
  flow: FlowDefinition
}

export interface RouteInput {
  event: NormalizedEvent
  contact: ContactState
  waitingRun: WaitingRun | null
  candidates: readonly TriggerCandidate[]
  mediaPublishedAt: Date | null
  now: Date
}

export type Route =
  | { kind: 'resume'; runId: string; event: EngineEvent }
  | { kind: 'start'; automationId: string; trigger: StartTrigger }
  | { kind: 'ignore'; reason: string }

const ignore = (reason: string): Route => ({ kind: 'ignore', reason })

export function decideRoute(input: RouteInput): Route {
  const { event } = input
  switch (event.type) {
    case 'postback':
      return routePostback(input, event.payload)
    case 'comment_created': {
      const match = matchAutomation(
        { kind: 'comment', text: event.text, mediaId: event.mediaId, mediaPublishedAt: input.mediaPublishedAt },
        input.candidates,
      )
      if (!match) return ignore('no_matching_automation')
      return {
        kind: 'start',
        automationId: match.automationId,
        trigger: { kind: 'comment', commentId: event.commentId, text: event.text },
      }
    }
    case 'dm_received':
    case 'story_reply': {
      const { text } = event
      const { waitingRun } = input
      if (waitingRun && text !== null && acceptsReply(input, waitingRun, text)) {
        return { kind: 'resume', runId: waitingRun.id, event: { type: 'reply', text } }
      }
      const match =
        event.type === 'dm_received'
          ? matchAutomation({ kind: 'dm', text: text ?? '' }, input.candidates)
          : matchAutomation({ kind: 'story', text, isReaction: event.isReaction }, input.candidates)
      if (!match) return ignore('no_matching_automation')
      if (waitingRun && match.trigger.type === 'any_dm') return ignore('waiting_run_has_priority')
      const trigger: StartTrigger =
        event.type === 'dm_received' ? { kind: 'dm', text: text ?? '' } : { kind: 'story', text }
      return { kind: 'start', automationId: match.automationId, trigger }
    }
  }
}

function acceptsReply(input: RouteInput, waitingRun: WaitingRun, text: string): boolean {
  const result = advance({
    run: waitingRun.run,
    flow: waitingRun.flow,
    contact: input.contact,
    event: { type: 'reply', text },
    now: input.now,
  })
  return !result.ignored
}

function routePostback(input: RouteInput, payload: string): Route {
  const decoded = decodePostback(payload)
  if (!decoded) return ignore('unknown_postback')
  if (decoded.kind === 'run') {
    return {
      kind: 'resume',
      runId: decoded.runId,
      event: { type: 'postback', stepId: decoded.stepId, buttonId: decoded.buttonId },
    }
  }
  const candidate = input.candidates.find((c) => c.automationId === decoded.automationId)
  if (candidate?.trigger.type !== 'ice_breaker' || !candidate.trigger.items[decoded.itemIndex]) {
    return ignore('unknown_ice_breaker')
  }
  return {
    kind: 'start',
    automationId: candidate.automationId,
    trigger: { kind: 'ice_breaker', itemIndex: decoded.itemIndex },
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @replyooo/worker test route && pnpm --filter @replyooo/worker typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): decide how inbound events route to runs and automations"
```

---

### Task 12: Worker: inbound handler

**Files:**
- Create: `apps/worker/src/inbound.ts`
- Modify: `apps/worker/test/support.ts` (add `insertRun`)
- Test: `apps/worker/test/inbound.test.ts`

**Interfaces:**
- Consumes: `decideRoute` (Task 11), record helpers (Task 9), `Deps` (Task 8).
- Produces:
  ```ts
  const REENTRY_COOLDOWN_MS = 24 * 60 * 60 * 1000
  function handleInbound(deps: Deps, webhookEventId: string): Promise<void>
  type Candidate = TriggerCandidate & { versionId: string }
  function loadCandidates(db: Db, accountId: string): Promise<Candidate[]>
  ```
  Behaviour:
  - Skips events already `processed_at`. Events for unknown or non-`active` accounts are marked processed and dropped.
  - Before the transaction: load the existing contact, fetch the profile for **new** contacts (best effort, failures are logged), load candidates (`active` automations joined to their `current_version_id`) and the contact's waiting run, fetch the media publish time only when an unpinned `next`-mode comment automation exists, then `decideRoute`.
  - In one transaction: upsert the contact (`last_inbound_at` = max(old, event time) for messaging events; comments don't open the DM window), insert the inbound `messages` row (`dm` / `story_reply` / `postback` / `comment`), then apply the route:
    - `resume`: the run must belong to this contact → flow job `{ runId, event }`.
    - `start`: cooldown via a conditional upsert on `automation_entries` (no row returned = still cooling down → no run). Cancel the contact's waiting run, pin `next`-mode media, insert the `flow_runs` row (`running`, version 0, `trigger_ref` = the start trigger, `comment_id`) → flow job `{ runId, event: { type: 'start', trigger }, expectedVersion: 0 }`.
    - Mark the webhook event processed.
  - After commit: enqueue the flow job. If processing throws, store `error` on the event and rethrow (BullMQ retries).

- [ ] **Step 1: Add the run seeding helper**

Append to `apps/worker/test/support.ts`:
```ts
import { flowRuns } from '@replyooo/db'
import type { FlowRunState } from '@replyooo/engine'
import { newRunState } from '@replyooo/engine'
import { runColumns } from '../src/records'

export async function insertRun(
  db: Db,
  refs: {
    account: AccountRow
    contact: { id: string }
    automation: { id: string }
    version: { id: string }
  },
  state: Partial<FlowRunState> = {},
) {
  const [run] = await db
    .insert(flowRuns)
    .values({
      automationId: refs.automation.id,
      automationVersionId: refs.version.id,
      contactId: refs.contact.id,
      connectedAccountId: refs.account.id,
      ...runColumns({ ...newRunState(), ...state }, NOW),
    })
    .returning()
  return run!
}
```
Move the new `import` lines to the top of the file with the other imports.

- [ ] **Step 2: Write the failing test**

`apps/worker/test/inbound.test.ts`:
```ts
import { automationEntries, automations, connectedAccounts, contacts, flowRuns, messages, webhookEvents } from '@replyooo/db'
import type { FlowDefinition } from '@replyooo/shared'
import { encodePostback } from '@replyooo/shared'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { handleInbound } from '../src/inbound'
import {
  comment,
  createTestContext,
  dm,
  insertEvent,
  insertRun,
  NOW,
  postback,
  publishAutomation,
  seedAccount,
  seedContact,
} from './support'

const keywordFlow: FlowDefinition = {
  trigger: { type: 'dm_keyword', keywords: ['price'], match: 'contains' },
  start: 's1',
  steps: { s1: { type: 'send_message', text: 'Prices start at ₹499' } },
}

const anyDmFlow: FlowDefinition = {
  trigger: { type: 'any_dm' },
  start: 's1',
  steps: { s1: { type: 'send_message', text: 'Thanks for writing!' } },
}

const askFlow: FlowDefinition = {
  trigger: { type: 'dm_keyword', keywords: ['guide'], match: 'contains' },
  start: 'ask',
  steps: {
    ask: {
      type: 'ask',
      question: 'Email?',
      saveTo: 'email',
      validate: 'email',
      retryText: 'Try again',
      maxAttempts: 2,
      timeoutMinutes: 1440,
    },
  },
}

const commentFlow = (posts: { mode: 'any' } | { mode: 'next' } = { mode: 'any' }): FlowDefinition => ({
  trigger: { type: 'comment_keyword', posts, keywords: ['guide'], match: 'contains' },
  start: 's1',
  steps: {
    s1: { type: 'send_message', text: 'Tap below', buttons: [{ type: 'reply', id: 'b1', label: 'Send it', next: 's2' }] },
    s2: { type: 'send_message', text: 'Here you go' },
  },
})

async function setup(platform: 'instagram' | 'facebook' = 'instagram') {
  const ctx = createTestContext()
  const { account } = await seedAccount(ctx.deps.db, { platform })
  return { ...ctx, db: ctx.deps.db, account }
}

describe('handleInbound', () => {
  it('drops events for unknown accounts', async () => {
    const { db, deps, jobs, account } = await setup()
    const id = await insertEvent(db, dm({ ...account, externalId: 'someone-else' }, 'u1', 'price'))
    await handleInbound(deps, id)
    const [event] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, id))
    expect(event?.processedAt).toEqual(NOW)
    expect(jobs.flows).toEqual([])
  })

  it('drops events for accounts that need reauth', async () => {
    const { db, deps, jobs, account } = await setup()
    await publishAutomation(db, account, anyDmFlow)
    await db.update(connectedAccounts).set({ status: 'reauth_required' }).where(eq(connectedAccounts.id, account.id))
    await handleInbound(deps, await insertEvent(db, dm(account, 'u1', 'hi')))
    expect(jobs.flows).toEqual([])
  })

  it('creates the contact, logs the message and starts a keyword run', async () => {
    const { db, deps, jobs, adapters, account } = await setup()
    const { automation } = await publishAutomation(db, account, keywordFlow)
    const id = await insertEvent(db, dm(account, 'u1', 'PRICE?'))
    await handleInbound(deps, id)

    const [contact] = await db.select().from(contacts).where(eq(contacts.connectedAccountId, account.id))
    expect(contact).toMatchObject({ platformUserId: 'u1', name: 'Priya Sharma', username: 'priya', lastInboundAt: NOW })
    expect(adapters.instagram.sent('getProfile')).toHaveLength(1)

    const [inbound] = await db.select().from(messages).where(eq(messages.contactId, contact!.id))
    expect(inbound).toMatchObject({ direction: 'in', kind: 'dm', status: 'received', body: { text: 'PRICE?' } })

    const [run] = await db.select().from(flowRuns).where(eq(flowRuns.contactId, contact!.id))
    expect(run).toMatchObject({ automationId: automation.id, status: 'running', stateVersion: 0 })
    expect(jobs.flows).toEqual([
      { data: { runId: run!.id, event: { type: 'start', trigger: { kind: 'dm', text: 'PRICE?' } }, expectedVersion: 0 } },
    ])
    const [event] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, id))
    expect(event?.processedAt).toEqual(NOW)
  })

  it('processes each webhook event once', async () => {
    const { db, deps, jobs, account } = await setup()
    await publishAutomation(db, account, keywordFlow)
    const id = await insertEvent(db, dm(account, 'u1', 'price'))
    await handleInbound(deps, id)
    await handleInbound(deps, id)
    expect(jobs.flows).toHaveLength(1)
  })

  it('enforces the 24h re-entry cooldown', async () => {
    const { db, deps, jobs, clock, account } = await setup()
    const { automation } = await publishAutomation(db, account, keywordFlow)
    await handleInbound(deps, await insertEvent(db, dm(account, 'u1', 'price')))
    clock.now = new Date(NOW.getTime() + 23 * 3_600_000)
    await handleInbound(deps, await insertEvent(db, dm(account, 'u1', 'price again')))
    expect(jobs.flows).toHaveLength(1)
    clock.now = new Date(NOW.getTime() + 25 * 3_600_000)
    await handleInbound(deps, await insertEvent(db, dm(account, 'u1', 'price once more')))
    expect(jobs.flows).toHaveLength(2)
    const entries = await db.select().from(automationEntries).where(eq(automationEntries.automationId, automation.id))
    expect(entries).toHaveLength(1)
    expect(entries[0]?.lastEnteredAt).toEqual(clock.now)
  })

  it('starts comment runs without opening the DM window', async () => {
    const { db, deps, jobs, account } = await setup()
    await publishAutomation(db, account, commentFlow())
    await handleInbound(deps, await insertEvent(db, comment(account, 'u2', 'GUIDE', { commentId: 'c-1' })))
    const [contact] = await db.select().from(contacts).where(eq(contacts.connectedAccountId, account.id))
    expect(contact).toMatchObject({ username: 'priya', lastInboundAt: null })
    const [logged] = await db.select().from(messages).where(eq(messages.contactId, contact!.id))
    expect(logged).toMatchObject({ kind: 'comment', commentId: 'c-1', externalId: 'c-1' })
    const [run] = await db.select().from(flowRuns).where(eq(flowRuns.contactId, contact!.id))
    expect(run).toMatchObject({ commentId: 'c-1', triggerRef: { kind: 'comment', commentId: 'c-1', text: 'GUIDE' } })
    expect(jobs.flows[0]?.data.event).toEqual({ type: 'start', trigger: { kind: 'comment', commentId: 'c-1', text: 'GUIDE' } })
  })

  it('pins the first matching post for next-post comment automations', async () => {
    const { db, deps, jobs, adapters, account } = await setup()
    const { automation } = await publishAutomation(db, account, commentFlow({ mode: 'next' }), {
      publishedAt: new Date(NOW.getTime() - 3_600_000),
    })
    adapters.instagram.mediaPublishedAt = new Date(NOW.getTime() - 60_000)
    await handleInbound(deps, await insertEvent(db, comment(account, 'u3', 'guide', { mediaId: 'new-post' })))
    expect(jobs.flows).toHaveLength(1)
    const [row] = await db.select().from(automations).where(eq(automations.id, automation.id))
    expect(row?.pinnedMediaId).toBe('new-post')
  })

  it('resumes the waiting run with the answer instead of starting any_dm', async () => {
    const { db, deps, jobs, account } = await setup()
    const ask = await publishAutomation(db, account, askFlow)
    await publishAutomation(db, account, anyDmFlow)
    const contact = await seedContact(db, account, { platformUserId: 'u4' })
    const run = await insertRun(db, { account, contact, ...ask }, {
      status: 'waiting',
      currentStepId: 'ask',
      wait: { kind: 'reply', attempts: 0 },
      waitUntil: new Date(NOW.getTime() + 86_400_000),
      stateVersion: 1,
    })
    await handleInbound(deps, await insertEvent(db, dm(account, 'u4', 'priya@gmail.com')))
    expect(jobs.flows).toEqual([{ data: { runId: run.id, event: { type: 'reply', text: 'priya@gmail.com' } } }])
    const runs = await db.select().from(flowRuns).where(eq(flowRuns.contactId, contact.id))
    expect(runs).toHaveLength(1)
  })

  it('a keyword interrupts a waiting run, which is cancelled', async () => {
    const { db, deps, jobs, account } = await setup()
    const ask = await publishAutomation(db, account, askFlow)
    await publishAutomation(db, account, keywordFlow)
    const contact = await seedContact(db, account, { platformUserId: 'u5' })
    // A run sitting in a delay ignores plain replies, so a keyword DM starts a new run instead.
    const old = await insertRun(db, { account, contact, ...ask }, {
      status: 'waiting',
      currentStepId: 'ask',
      wait: { kind: 'delay' },
      waitUntil: new Date(NOW.getTime() + 86_400_000),
      stateVersion: 1,
    })
    await handleInbound(deps, await insertEvent(db, dm(account, 'u5', 'price')))
    const [cancelled] = await db.select().from(flowRuns).where(eq(flowRuns.id, old.id))
    expect(cancelled).toMatchObject({ status: 'cancelled', stateVersion: 2 })
    expect(jobs.flows[0]?.data.event.type).toBe('start')
  })

  it('ignores button postbacks that point at another contact’s run', async () => {
    const { db, deps, jobs, account } = await setup()
    const flow = await publishAutomation(db, account, commentFlow())
    const owner = await seedContact(db, account, { platformUserId: 'owner' })
    const run = await insertRun(db, { account, contact: owner, ...flow }, { status: 'waiting', wait: { kind: 'postback' } })
    const payload = encodePostback({ kind: 'run', runId: run.id, stepId: 's1', buttonId: 'b1' })
    await handleInbound(deps, await insertEvent(db, postback(account, 'intruder', payload)))
    expect(jobs.flows).toEqual([])
    await handleInbound(deps, await insertEvent(db, postback(account, 'owner', payload)))
    expect(jobs.flows).toEqual([
      { data: { runId: run.id, event: { type: 'postback', stepId: 's1', buttonId: 'b1' } } },
    ])
  })

  it('starts ice breaker runs from their postback payload', async () => {
    const { db, deps, jobs, account } = await setup('facebook')
    const { automation } = await publishAutomation(db, account, {
      trigger: { type: 'ice_breaker', items: [{ question: 'Hours?', startStep: 's1' }] },
      start: 's1',
      steps: { s1: { type: 'send_message', text: '9 to 5' } },
    })
    const payload = encodePostback({ kind: 'ice_breaker', automationId: automation.id, itemIndex: 0 })
    await handleInbound(deps, await insertEvent(db, postback(account, 'psid_9', payload)))
    expect(jobs.flows[0]?.data.event).toEqual({ type: 'start', trigger: { kind: 'ice_breaker', itemIndex: 0 } })
    const [logged] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.connectedAccountId, account.id), eq(messages.kind, 'postback')))
    expect(logged?.body).toEqual({ payload, title: null })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @replyooo/worker test inbound`
Expected: FAIL. `../src/inbound` doesn't exist yet.

- [ ] **Step 4: Implement**

`apps/worker/src/inbound.ts`:
```ts
import type { Db, Tx } from '@replyooo/db'
import {
  automationEntries,
  automationVersions,
  automations,
  connectedAccounts,
  contacts,
  flowRuns,
  messages,
  webhookEvents,
} from '@replyooo/db'
import type { TriggerCandidate } from '@replyooo/engine'
import type { AccountCredentials, NormalizedEvent, PlatformAdapter, Profile } from '@replyooo/meta'
import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import type { Deps, FlowJobData } from './deps'
import type { AccountRow, ContactRow } from './records'
import { credentials, toContactState, toRunState } from './records'
import type { Route, WaitingRun } from './route'
import { decideRoute } from './route'

export const REENTRY_COOLDOWN_MS = 24 * 60 * 60 * 1000

export type Candidate = TriggerCandidate & { versionId: string }

export async function handleInbound(deps: Deps, webhookEventId: string): Promise<void> {
  const [row] = await deps.db.select().from(webhookEvents).where(eq(webhookEvents.id, webhookEventId))
  if (!row || row.processedAt) return
  try {
    const job = await processEvent(deps, row.id, row.payload as NormalizedEvent)
    if (job) await deps.jobs.flow(job)
  } catch (error) {
    await deps.db
      .update(webhookEvents)
      .set({ error: error instanceof Error ? error.message : String(error) })
      .where(eq(webhookEvents.id, row.id))
    throw error
  }
}

async function processEvent(deps: Deps, eventRowId: string, event: NormalizedEvent): Promise<FlowJobData | null> {
  const { db } = deps
  const now = deps.now()
  const markProcessed = (executor: Db | Tx) =>
    executor.update(webhookEvents).set({ processedAt: now, error: null }).where(eq(webhookEvents.id, eventRowId))

  const [account] = await db
    .select()
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.platform, event.platform), eq(connectedAccounts.externalId, event.accountExternalId)))
  if (!account || account.status !== 'active') {
    await markProcessed(db)
    return null
  }

  const adapter = deps.adapters[account.platform]
  const creds = credentials(account, deps.tokenKey)
  const [existing] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.connectedAccountId, account.id), eq(contacts.platformUserId, event.senderId)))
  const profile = existing ? null : await fetchProfile(deps, adapter, creds, event.senderId)
  const candidates = await loadCandidates(db, account.id)
  const waitingRun = existing ? await loadWaitingRun(db, existing.id) : null
  const mediaPublishedAt =
    event.type === 'comment_created' && needsMediaTime(candidates)
      ? await adapter.getMediaPublishedAt(creds, event.mediaId).catch(() => null)
      : null

  const route = decideRoute({
    event,
    contact: existing ? toContactState(existing) : newContactState(event, profile),
    waitingRun,
    candidates,
    mediaPublishedAt,
    now,
  })
  if (route.kind === 'ignore') deps.log.debug({ reason: route.reason, eventRowId }, 'inbound event not routed')

  return db.transaction(async (tx) => {
    const contact = await upsertContact(tx, account, event, profile, now)
    const job = await applyRoute(tx, { account, contact, route, candidates, event, now })
    await tx.insert(messages).values(inboundMessage(account, contact, event, job?.runId ?? null))
    await markProcessed(tx)
    return job
  })
}

export async function loadCandidates(db: Db, accountId: string): Promise<Candidate[]> {
  const rows = await db
    .select({
      automationId: automations.id,
      versionId: automationVersions.id,
      definition: automationVersions.definition,
      publishedAt: automationVersions.publishedAt,
      pinnedMediaId: automations.pinnedMediaId,
    })
    .from(automations)
    .innerJoin(automationVersions, eq(automations.currentVersionId, automationVersions.id))
    .where(and(eq(automations.connectedAccountId, accountId), eq(automations.status, 'active')))
  return rows.map((row) => ({
    automationId: row.automationId,
    versionId: row.versionId,
    publishedAt: row.publishedAt,
    trigger: row.definition.trigger,
    pinnedMediaId: row.pinnedMediaId,
  }))
}

async function loadWaitingRun(db: Db, contactId: string): Promise<WaitingRun | null> {
  const [row] = await db
    .select({ run: flowRuns, definition: automationVersions.definition })
    .from(flowRuns)
    .innerJoin(automationVersions, eq(flowRuns.automationVersionId, automationVersions.id))
    .where(and(eq(flowRuns.contactId, contactId), eq(flowRuns.status, 'waiting')))
    .limit(1)
  return row ? { id: row.run.id, run: toRunState(row.run), flow: row.definition } : null
}

function needsMediaTime(candidates: readonly Candidate[]): boolean {
  return candidates.some(
    (c) => c.trigger.type === 'comment_keyword' && c.trigger.posts.mode === 'next' && !c.pinnedMediaId,
  )
}

async function fetchProfile(
  deps: Deps,
  adapter: PlatformAdapter,
  creds: AccountCredentials,
  userId: string,
): Promise<Profile | null> {
  try {
    return await adapter.getProfile(creds, userId)
  } catch (error) {
    deps.log.warn({ err: error, userId }, 'profile lookup failed')
    return null
  }
}

function newContactState(event: NormalizedEvent, profile: Profile | null) {
  return {
    username: event.type === 'comment_created' ? event.senderUsername : (profile?.username ?? null),
    name: profile?.name ?? (event.type === 'comment_created' ? event.senderName : null),
    email: null,
    phone: null,
    tags: [],
    fields: {},
  }
}

async function upsertContact(
  tx: Tx,
  account: AccountRow,
  event: NormalizedEvent,
  profile: Profile | null,
  now: Date,
): Promise<ContactRow> {
  const messaging = event.type !== 'comment_created'
  const initial = newContactState(event, profile)
  const [contact] = await tx
    .insert(contacts)
    .values({
      workspaceId: account.workspaceId,
      connectedAccountId: account.id,
      platformUserId: event.senderId,
      username: initial.username,
      name: initial.name,
      avatarUrl: profile?.avatarUrl ?? null,
      lastInboundAt: messaging ? new Date(event.occurredAt) : null,
    })
    .onConflictDoUpdate({
      target: [contacts.connectedAccountId, contacts.platformUserId],
      set: {
        username: sql`coalesce(excluded.username, ${contacts.username})`,
        name: sql`coalesce(${contacts.name}, excluded.name)`,
        ...(messaging ? { lastInboundAt: sql`greatest(${contacts.lastInboundAt}, excluded.last_inbound_at)` } : {}),
        updatedAt: now,
      },
    })
    .returning()
  return contact!
}

interface ApplyContext {
  account: AccountRow
  contact: ContactRow
  route: Route
  candidates: readonly Candidate[]
  event: NormalizedEvent
  now: Date
}

async function applyRoute(tx: Tx, ctx: ApplyContext): Promise<FlowJobData | null> {
  const { route, contact, account, now, event } = ctx
  if (route.kind === 'ignore') return null

  if (route.kind === 'resume') {
    const [run] = await tx
      .select({ id: flowRuns.id, contactId: flowRuns.contactId })
      .from(flowRuns)
      .where(eq(flowRuns.id, route.runId))
    return run && run.contactId === contact.id ? { runId: run.id, event: route.event } : null
  }

  const candidate = ctx.candidates.find((c) => c.automationId === route.automationId)
  if (!candidate) return null

  const entered = await tx
    .insert(automationEntries)
    .values({ automationId: candidate.automationId, contactId: contact.id, lastEnteredAt: now })
    .onConflictDoUpdate({
      target: [automationEntries.automationId, automationEntries.contactId],
      set: { lastEnteredAt: now },
      setWhere: lt(automationEntries.lastEnteredAt, new Date(now.getTime() - REENTRY_COOLDOWN_MS)),
    })
    .returning({ id: automationEntries.id })
  if (entered.length === 0) return null

  await tx
    .update(flowRuns)
    .set({
      status: 'cancelled',
      wait: null,
      waitUntil: null,
      completedAt: now,
      stateVersion: sql`${flowRuns.stateVersion} + 1`,
    })
    .where(and(eq(flowRuns.contactId, contact.id), eq(flowRuns.status, 'waiting')))

  if (
    event.type === 'comment_created' &&
    candidate.trigger.type === 'comment_keyword' &&
    candidate.trigger.posts.mode === 'next' &&
    !candidate.pinnedMediaId
  ) {
    await tx
      .update(automations)
      .set({ pinnedMediaId: event.mediaId })
      .where(and(eq(automations.id, candidate.automationId), isNull(automations.pinnedMediaId)))
  }

  const [run] = await tx
    .insert(flowRuns)
    .values({
      automationId: candidate.automationId,
      automationVersionId: candidate.versionId,
      contactId: contact.id,
      connectedAccountId: account.id,
      status: 'running',
      triggerRef: route.trigger as unknown as Record<string, unknown>,
      commentId: route.trigger.kind === 'comment' ? route.trigger.commentId : null,
    })
    .returning({ id: flowRuns.id })
  return { runId: run!.id, event: { type: 'start', trigger: route.trigger }, expectedVersion: 0 }
}

function inboundMessage(account: AccountRow, contact: ContactRow, event: NormalizedEvent, runId: string | null) {
  const common = {
    contactId: contact.id,
    connectedAccountId: account.id,
    flowRunId: runId,
    direction: 'in' as const,
    status: 'received' as const,
  }
  switch (event.type) {
    case 'dm_received':
      return { ...common, kind: 'dm' as const, body: { text: event.text }, externalId: event.messageId }
    case 'story_reply':
      return {
        ...common,
        kind: 'story_reply' as const,
        body: { text: event.text, isReaction: event.isReaction },
        externalId: event.messageId,
      }
    case 'postback':
      return {
        ...common,
        kind: 'postback' as const,
        body: { payload: event.payload, title: event.title },
        externalId: event.messageId,
      }
    case 'comment_created':
      return {
        ...common,
        kind: 'comment' as const,
        body: { text: event.text, mediaId: event.mediaId },
        externalId: event.commentId,
        commentId: event.commentId,
      }
  }
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @replyooo/worker test inbound && pnpm --filter @replyooo/worker typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): route inbound events to runs and start automations"
```

---

### Task 13: Worker: flow consumer + follow check

**Files:**
- Create: `apps/worker/src/flow.ts`
- Test: `apps/worker/test/flow.test.ts`

**Interfaces:**
- Consumes: `advance` from `@replyooo/engine`, record helpers (Task 9).
- Produces:
  ```ts
  type OutboundBody =
    | { type: 'message'; message: OutboundMessage }   // text + buttons, never an image
    | { type: 'image'; url: string }
    | { type: 'comment'; text: string }
  function outboundRows(effects: readonly Effect[]): { kind: 'dm' | 'private_reply' | 'comment_reply'; commentId: string | null; body: OutboundBody }[]
  function handleFlowJob(deps: Deps, job: FlowJobData): Promise<void>
  function handleFollowCheck(deps: Deps, job: FollowCheckJobData): Promise<void>
  ```
  `handleFlowJob`, in one transaction:
  1. Lock the run (`FOR UPDATE`). No-op if it's missing, if `expectedVersion` is set and doesn't match, or if the status isn't `running`/`waiting`.
  2. Lock the contact and load the run's version, then call `advance`. No-op if `ignored`.
  3. If the run is now `waiting`, cancel the contact's other `waiting` runs (newest wins; keeps the partial unique index happy).
  4. Write the run (`runColumns`), the contact patch (`applyContactEffects`), and one `messages` row per send (`outboundRows`, in effect order; `send` with an image → image row, then message row).

  After commit: one `outbound` job with every new message id (in order), a delayed `flow` timeout job per `schedule_timeout` (`expectedVersion` = new version, `jobId: timeout-<runId>-<version>`), and a `followCheck` job per `check_follow`.

  `handleFollowCheck`: no-op unless the run is still `waiting` on `follow_check` at `expectedVersion`. Calls `adapter.isFollower` (an adapter without it counts as "not following") and enqueues a `follow_result` flow job with the same `expectedVersion`. `reauth`/`permanent` MetaErrors end the run as `failed` (`reauth` also flags the account). `retryable` errors are rethrown for BullMQ to retry; if retries run out, the 5-minute follow-check timeout fails the run.

- [ ] **Step 1: Write the failing test**

`apps/worker/test/flow.test.ts`:
```ts
import { connectedAccounts, contacts, flowRuns, messages } from '@replyooo/db'
import { MetaError } from '@replyooo/meta'
import type { FlowDefinition } from '@replyooo/shared'
import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { handleFlowJob, handleFollowCheck, outboundRows } from '../src/flow'
import { createTestContext, insertRun, NOW, publishAutomation, seedAccount, seedContact } from './support'

const keywordFlow: FlowDefinition = {
  trigger: { type: 'dm_keyword', keywords: ['price'], match: 'contains' },
  start: 's1',
  steps: { s1: { type: 'send_message', text: 'Hi {{first_name|there}}, prices start at ₹499' } },
}

const commentFlow: FlowDefinition = {
  trigger: {
    type: 'comment_keyword',
    posts: { mode: 'any' },
    keywords: ['guide'],
    match: 'contains',
    publicReplies: ['Check your DMs!'],
  },
  start: 's1',
  steps: {
    s1: { type: 'send_message', text: 'Tap below', buttons: [{ type: 'reply', id: 'b1', label: 'Send it', next: 's2' }] },
    s2: { type: 'send_message', text: 'Here you go', imageUrl: 'https://cdn.example.com/guide.png' },
  },
}

const askFlow: FlowDefinition = {
  trigger: { type: 'dm_keyword', keywords: ['guide'], match: 'contains' },
  start: 'ask',
  steps: {
    ask: {
      type: 'ask',
      question: 'Email?',
      saveTo: 'email',
      validate: 'email',
      retryText: 'Try again',
      maxAttempts: 2,
      timeoutMinutes: 1440,
      answered: 'tag',
    },
    tag: { type: 'tag', add: ['lead'], next: 'thanks' },
    thanks: { type: 'send_message', text: 'Sent to {{email}}' },
  },
}

const followGate: FlowDefinition = {
  trigger: { type: 'any_dm' },
  start: 'check',
  steps: {
    check: { type: 'check_follow', following: 'yes', notFollowing: 'no' },
    yes: { type: 'send_message', text: 'Thanks for following' },
    no: { type: 'send_message', text: 'Follow first' },
  },
}

async function setup(flow: FlowDefinition, contactValues: Parameters<typeof seedContact>[2] = {}) {
  const ctx = createTestContext()
  const db = ctx.deps.db
  const { account } = await seedAccount(db)
  const published = await publishAutomation(db, account, flow)
  const contact = await seedContact(db, account, { name: 'Priya Sharma', ...contactValues })
  const refs = { account, contact, ...published }
  return { ...ctx, db, ...refs, refs }
}

const outbound = (db: ReturnType<typeof createTestContext>['deps']['db'], runId: string) =>
  db.select().from(messages).where(eq(messages.flowRunId, runId)).orderBy(asc(messages.id))

describe('outboundRows', () => {
  it('splits images into their own row', () => {
    expect(
      outboundRows([
        { type: 'comment_reply', commentId: 'c1', text: 'See DMs' },
        { type: 'send', message: { text: 'Here', imageUrl: 'https://img' } },
        { type: 'schedule_timeout', at: NOW },
      ]),
    ).toEqual([
      { kind: 'comment_reply', commentId: 'c1', body: { type: 'comment', text: 'See DMs' } },
      { kind: 'dm', commentId: null, body: { type: 'image', url: 'https://img' } },
      { kind: 'dm', commentId: null, body: { type: 'message', message: { text: 'Here' } } },
    ])
  })
})

describe('handleFlowJob', () => {
  it('starts a run, queues its messages and completes it', async () => {
    const { db, deps, jobs, refs } = await setup(keywordFlow)
    const run = await insertRun(db, refs)
    await handleFlowJob(deps, { runId: run.id, event: { type: 'start', trigger: { kind: 'dm', text: 'price' } }, expectedVersion: 0 })

    const [after] = await db.select().from(flowRuns).where(eq(flowRuns.id, run.id))
    expect(after).toMatchObject({ status: 'completed', stateVersion: 1, completedAt: NOW })
    const rows = await outbound(db, run.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      direction: 'out',
      kind: 'dm',
      status: 'queued',
      body: { type: 'message', message: { text: 'Hi Priya, prices start at ₹499' } },
    })
    expect(jobs.outbounds).toEqual([{ messageIds: [rows[0]!.id] }])
  })

  it('comment flows queue the public and private reply, then wait for the tap', async () => {
    const { db, deps, jobs, refs } = await setup(commentFlow)
    const run = await insertRun(db, refs)
    await handleFlowJob(deps, {
      runId: run.id,
      event: { type: 'start', trigger: { kind: 'comment', commentId: 'c9', text: 'guide' } },
      expectedVersion: 0,
    })
    const rows = await outbound(db, run.id)
    expect(rows.map((r) => [r.kind, r.commentId])).toEqual([
      ['comment_reply', 'c9'],
      ['private_reply', 'c9'],
    ])
    const [after] = await db.select().from(flowRuns).where(eq(flowRuns.id, run.id))
    expect(after).toMatchObject({ status: 'waiting', outbound: 'blocked', wait: { kind: 'postback' } })
    expect(jobs.flows).toEqual([
      {
        data: { runId: run.id, event: { type: 'timeout' }, expectedVersion: 1 },
        opts: { at: new Date(NOW.getTime() + 24 * 3_600_000), jobId: `timeout-${run.id}-1` },
      },
    ])

    jobs.clear()
    await handleFlowJob(deps, { runId: run.id, event: { type: 'postback', stepId: 's1', buttonId: 'b1' } })
    const all = await outbound(db, run.id)
    expect(all.slice(2).map((r) => r.body)).toEqual([
      { type: 'image', url: 'https://cdn.example.com/guide.png' },
      { type: 'message', message: { text: 'Here you go' } },
    ])
    expect(jobs.outbounds).toEqual([{ messageIds: all.slice(2).map((r) => r.id) }])
  })

  it('saves answers to the contact', async () => {
    const { db, deps, refs } = await setup(askFlow)
    const run = await insertRun(db, refs, {
      status: 'waiting',
      currentStepId: 'ask',
      wait: { kind: 'reply', attempts: 0 },
      waitUntil: new Date(NOW.getTime() + 86_400_000),
      stateVersion: 1,
    })
    await handleFlowJob(deps, { runId: run.id, event: { type: 'reply', text: 'PRIYA@Gmail.com' } })
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, refs.contact.id))
    expect(contact).toMatchObject({ email: 'priya@gmail.com', tags: ['lead'] })
    const rows = await outbound(db, run.id)
    expect(rows.at(-1)?.body).toEqual({ type: 'message', message: { text: 'Sent to priya@gmail.com' } })
  })

  it('timeout with a stale expectedVersion is a no-op', async () => {
    const { db, deps, jobs, refs } = await setup(askFlow)
    const run = await insertRun(db, refs, {
      status: 'waiting',
      currentStepId: 'ask',
      wait: { kind: 'reply', attempts: 0 },
      waitUntil: new Date(NOW.getTime() - 1000),
      stateVersion: 3,
    })
    await handleFlowJob(deps, { runId: run.id, event: { type: 'timeout' }, expectedVersion: 2 })
    const [after] = await db.select().from(flowRuns).where(eq(flowRuns.id, run.id))
    expect(after).toMatchObject({ status: 'waiting', stateVersion: 3 })
    expect(jobs.outbounds).toEqual([])
  })

  it('ignores events the engine ignores and runs that already ended', async () => {
    const { db, deps, jobs, refs } = await setup(keywordFlow)
    const ended = await insertRun(db, refs, { status: 'completed', stateVersion: 1 })
    await handleFlowJob(deps, { runId: ended.id, event: { type: 'reply', text: 'hi' } })
    const [after] = await db.select().from(flowRuns).where(eq(flowRuns.id, ended.id))
    expect(after?.stateVersion).toBe(1)
    expect(jobs.outbounds).toEqual([])
  })

  it('a run that starts waiting cancels the contact’s other waiting run', async () => {
    const { db, deps, refs } = await setup(commentFlow)
    const older = await insertRun(db, refs, { status: 'waiting', wait: { kind: 'delay' }, stateVersion: 2 })
    const newer = await insertRun(db, refs)
    await handleFlowJob(deps, {
      runId: newer.id,
      event: { type: 'start', trigger: { kind: 'comment', commentId: 'c10', text: 'guide' } },
      expectedVersion: 0,
    })
    const [o] = await db.select().from(flowRuns).where(eq(flowRuns.id, older.id))
    const [n] = await db.select().from(flowRuns).where(eq(flowRuns.id, newer.id))
    expect(o).toMatchObject({ status: 'cancelled', stateVersion: 3 })
    expect(n?.status).toBe('waiting')
  })

  it('check_follow enqueues a follow check', async () => {
    const { db, deps, jobs, refs } = await setup(followGate)
    const run = await insertRun(db, refs)
    await handleFlowJob(deps, { runId: run.id, event: { type: 'start', trigger: { kind: 'dm', text: 'hi' } }, expectedVersion: 0 })
    expect(jobs.followChecks).toEqual([{ runId: run.id, expectedVersion: 1 }])
  })
})

describe('handleFollowCheck', () => {
  const waitingCheck = { status: 'waiting' as const, currentStepId: 'check', wait: { kind: 'follow_check' as const }, stateVersion: 1 }

  it('reports the follow status back to the run', async () => {
    const { db, deps, jobs, adapters, refs } = await setup(followGate)
    const run = await insertRun(db, refs, waitingCheck)
    adapters.instagram.following = true
    await handleFollowCheck(deps, { runId: run.id, expectedVersion: 1 })
    expect(adapters.instagram.sent('isFollower')[0]?.args).toEqual([refs.contact.platformUserId])
    expect(jobs.flows).toEqual([
      { data: { runId: run.id, event: { type: 'follow_result', following: true }, expectedVersion: 1 } },
    ])
  })

  it('does nothing for stale checks', async () => {
    const { db, deps, jobs, adapters, refs } = await setup(followGate)
    const run = await insertRun(db, refs, { ...waitingCheck, stateVersion: 2 })
    await handleFollowCheck(deps, { runId: run.id, expectedVersion: 1 })
    expect(adapters.instagram.sent('isFollower')).toEqual([])
    expect(jobs.flows).toEqual([])
  })

  it('fails the run and flags the account on reauth errors; rethrows retryable ones', async () => {
    const { db, deps, adapters, refs } = await setup(followGate)
    const run = await insertRun(db, refs, waitingCheck)
    adapters.instagram.errors.push(new MetaError('retryable', 'busy'))
    await expect(handleFollowCheck(deps, { runId: run.id, expectedVersion: 1 })).rejects.toThrow('busy')

    adapters.instagram.errors.push(new MetaError('reauth', 'token expired', { reason: 'token_invalid' }))
    await handleFollowCheck(deps, { runId: run.id, expectedVersion: 1 })
    const [after] = await db.select().from(flowRuns).where(eq(flowRuns.id, run.id))
    expect(after).toMatchObject({ status: 'failed', error: 'token_invalid' })
    const [account] = await db.select().from(connectedAccounts).where(eq(connectedAccounts.id, refs.account.id))
    expect(account?.status).toBe('reauth_required')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @replyooo/worker test flow`
Expected: FAIL. `../src/flow` doesn't exist yet.

- [ ] **Step 3: Implement**

`apps/worker/src/flow.ts`:
```ts
import { automationVersions, connectedAccounts, contacts, flowRuns, messages } from '@replyooo/db'
import type { Effect, OutboundMessage, Wait } from '@replyooo/engine'
import { advance } from '@replyooo/engine'
import { MetaError } from '@replyooo/meta'
import { and, eq, ne, sql } from 'drizzle-orm'
import type { Deps, FlowJobData, FollowCheckJobData } from './deps'
import {
  applyContactEffects,
  credentials,
  endRun,
  markReauthRequired,
  runColumns,
  toContactState,
  toRunState,
} from './records'

export type OutboundBody =
  | { type: 'message'; message: OutboundMessage }
  | { type: 'image'; url: string }
  | { type: 'comment'; text: string }

type OutboundKind = 'dm' | 'private_reply' | 'comment_reply'

export function outboundRows(
  effects: readonly Effect[],
): { kind: OutboundKind; commentId: string | null; body: OutboundBody }[] {
  const rows: { kind: OutboundKind; commentId: string | null; body: OutboundBody }[] = []
  for (const effect of effects) {
    switch (effect.type) {
      case 'send': {
        const { imageUrl, ...message } = effect.message
        if (imageUrl) rows.push({ kind: 'dm', commentId: null, body: { type: 'image', url: imageUrl } })
        rows.push({ kind: 'dm', commentId: null, body: { type: 'message', message } })
        break
      }
      case 'private_reply': {
        // Validation keeps images off a comment flow's first message; drop one defensively.
        const { imageUrl: _image, ...message } = effect.message
        rows.push({ kind: 'private_reply', commentId: effect.commentId, body: { type: 'message', message } })
        break
      }
      case 'comment_reply':
        rows.push({ kind: 'comment_reply', commentId: effect.commentId, body: { type: 'comment', text: effect.text } })
        break
    }
  }
  return rows
}

export async function handleFlowJob(deps: Deps, job: FlowJobData): Promise<void> {
  const now = deps.now()
  const outcome = await deps.db.transaction(async (tx) => {
    const [row] = await tx.select().from(flowRuns).where(eq(flowRuns.id, job.runId)).for('update')
    if (!row) return null
    if (job.expectedVersion !== undefined && row.stateVersion !== job.expectedVersion) return null
    if (row.status !== 'running' && row.status !== 'waiting') return null

    const [contact] = await tx.select().from(contacts).where(eq(contacts.id, row.contactId)).for('update')
    const [version] = await tx
      .select({ definition: automationVersions.definition })
      .from(automationVersions)
      .where(eq(automationVersions.id, row.automationVersionId))
    if (!contact || !version) return null

    const result = advance({
      run: toRunState(row),
      flow: version.definition,
      contact: toContactState(contact),
      event: job.event,
      now,
    })
    if (result.ignored) return null

    if (result.run.status === 'waiting') {
      await tx
        .update(flowRuns)
        .set({
          status: 'cancelled',
          wait: null,
          waitUntil: null,
          completedAt: now,
          stateVersion: sql`${flowRuns.stateVersion} + 1`,
        })
        .where(and(eq(flowRuns.contactId, row.contactId), eq(flowRuns.status, 'waiting'), ne(flowRuns.id, row.id)))
    }
    await tx.update(flowRuns).set(runColumns(result.run, now)).where(eq(flowRuns.id, row.id))

    const patch = applyContactEffects(contact, result.effects)
    if (patch) await tx.update(contacts).set({ ...patch, updatedAt: now }).where(eq(contacts.id, contact.id))

    const messageIds: string[] = []
    for (const out of outboundRows(result.effects)) {
      const [inserted] = await tx
        .insert(messages)
        .values({
          contactId: contact.id,
          connectedAccountId: row.connectedAccountId,
          flowRunId: row.id,
          direction: 'out',
          kind: out.kind,
          commentId: out.commentId,
          body: out.body as unknown as Record<string, unknown>,
          status: 'queued',
        })
        .returning({ id: messages.id })
      messageIds.push(inserted!.id)
    }
    return { version: result.run.stateVersion, effects: result.effects, messageIds }
  })
  if (!outcome) return

  if (outcome.messageIds.length > 0) await deps.jobs.outbound({ messageIds: outcome.messageIds })
  for (const effect of outcome.effects) {
    if (effect.type === 'schedule_timeout') {
      await deps.jobs.flow(
        { runId: job.runId, event: { type: 'timeout' }, expectedVersion: outcome.version },
        { at: effect.at, jobId: `timeout-${job.runId}-${outcome.version}` },
      )
    }
    if (effect.type === 'check_follow') {
      await deps.jobs.followCheck({ runId: job.runId, expectedVersion: outcome.version })
    }
  }
}

export async function handleFollowCheck(deps: Deps, job: FollowCheckJobData): Promise<void> {
  const [row] = await deps.db
    .select({ run: flowRuns, contact: contacts, account: connectedAccounts })
    .from(flowRuns)
    .innerJoin(contacts, eq(flowRuns.contactId, contacts.id))
    .innerJoin(connectedAccounts, eq(flowRuns.connectedAccountId, connectedAccounts.id))
    .where(eq(flowRuns.id, job.runId))
  if (!row) return
  const { run, contact, account } = row
  const wait = run.wait as Wait | null
  if (run.stateVersion !== job.expectedVersion || run.status !== 'waiting' || wait?.kind !== 'follow_check') return

  const adapter = deps.adapters[account.platform]
  let following = false
  if (adapter.isFollower) {
    try {
      following = await adapter.isFollower(credentials(account, deps.tokenKey), contact.platformUserId)
    } catch (error) {
      if (!(error instanceof MetaError) || error.kind === 'retryable') throw error
      if (error.kind === 'reauth') await markReauthRequired(deps.db, account.id)
      await endRun(deps.db, run.id, 'failed', error.details.reason ?? error.kind, deps.now())
      return
    }
  }
  await deps.jobs.flow({
    runId: run.id,
    event: { type: 'follow_result', following },
    expectedVersion: job.expectedVersion,
  })
}
```

> A duplicate `start` job is stopped by the `expectedVersion: 0` check, because the first start already bumped the version. The engine itself never ignores `start`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @replyooo/worker test flow && pnpm --filter @replyooo/worker typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): execute flow jobs and follow checks"
```

---

### Task 14: Worker: outbound consumer, rate limiter, usage counting

**Files:**
- Create: `apps/worker/src/outbound.ts`, `apps/worker/src/rate-limit.ts`
- Test: `apps/worker/test/outbound.test.ts`, `apps/worker/test/rate-limit.test.ts`

**Interfaces:**
- Produces:
  ```ts
  const DM_WINDOW_MS = 24 * 60 * 60 * 1000
  type OutboundResult = { status: 'done' } | { status: 'rate_limited'; retryInMs: number }
  function handleOutbound(deps: Deps, job: OutboundJobData, attempt?: { isFinal: boolean }): Promise<OutboundResult>
  function toSendable(body: OutboundBody, runId: string | null): SendableMessage
  function countUsage(db: Db, workspaceId: string, contactId: string, now: Date): Promise<void>
  function createRedisRateLimiter(redis: Redis, perSecond: number): RateLimiter
  ```
  Per message id, in order: skip unless `queued`. Fail (`account_inactive`) if the account isn't active. `dm` outside the 24h window → `window_closed` with no Graph call. Take a rate-limit token (on a wait, return `rate_limited` and leave everything queued). Send, then mark `sent` (guarded by `status = 'queued'`) and `countUsage`. Failures are handled as described in Global Constraints. When a message fails, every later id in the job is marked `failed: skipped` and the run ends.

- [ ] **Step 1: Write the failing tests**

`apps/worker/test/outbound.test.ts`:
```ts
import { connectedAccounts, contacts, flowRuns, messages, usageCounters } from '@replyooo/db'
import { MetaError } from '@replyooo/meta'
import type { FlowDefinition } from '@replyooo/shared'
import { decodePostback } from '@replyooo/shared'
import { and, eq, inArray } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { OutboundBody } from '../src/flow'
import { handleOutbound } from '../src/outbound'
import { createTestContext, insertRun, NOW, publishAutomation, seedAccount, seedContact } from './support'

const flow: FlowDefinition = {
  trigger: { type: 'any_dm' },
  start: 's1',
  steps: { s1: { type: 'send_message', text: 'hi' } },
}

type Queued = { kind: 'dm' | 'private_reply' | 'comment_reply'; body: OutboundBody; commentId?: string }

async function setup(contactValues: Parameters<typeof seedContact>[2] = {}) {
  const ctx = createTestContext()
  const db = ctx.deps.db
  const { account } = await seedAccount(db)
  const published = await publishAutomation(db, account, flow)
  const contact = await seedContact(db, account, contactValues)
  const run = await insertRun(db, { account, contact, ...published }, { status: 'waiting', wait: { kind: 'postback' }, stateVersion: 1 })
  const queue = async (...items: Queued[]) => {
    const ids: string[] = []
    for (const item of items) {
      const [row] = await db
        .insert(messages)
        .values({
          contactId: contact.id,
          connectedAccountId: account.id,
          flowRunId: run.id,
          direction: 'out',
          kind: item.kind,
          commentId: item.commentId ?? null,
          body: item.body as unknown as Record<string, unknown>,
          status: 'queued',
        })
        .returning({ id: messages.id })
      ids.push(row!.id)
    }
    return ids
  }
  const statuses = async (ids: string[]) =>
    (await db.select().from(messages).where(inArray(messages.id, ids))).map((m) => [m.id, m.status, m.error])
  return { ...ctx, db, account, contact, run, queue, statuses }
}

const text = (t: string): OutboundBody => ({ type: 'message', message: { text: t } })

describe('handleOutbound', () => {
  it('sends in order, encodes button payloads and marks messages sent', async () => {
    const { deps, adapters, contact, run, queue, db } = await setup()
    const ids = await queue(
      { kind: 'dm', body: { type: 'image', url: 'https://img' } },
      {
        kind: 'dm',
        body: {
          type: 'message',
          message: {
            text: 'Want it?',
            buttons: [
              { type: 'reply', label: 'Send it', stepId: 's1', buttonId: 'b1' },
              { type: 'url', label: 'Shop', url: 'https://shop' },
            ],
          },
        },
      },
    )
    expect(await handleOutbound(deps, { messageIds: ids })).toEqual({ status: 'done' })

    const calls = adapters.instagram.sent('sendMessage')
    expect(calls.map((c) => c.args)).toEqual([
      [contact.platformUserId, { kind: 'image', url: 'https://img' }],
      [
        contact.platformUserId,
        {
          kind: 'text',
          text: 'Want it?',
          buttons: [
            { type: 'postback', label: 'Send it', payload: `r:${run.id}:s1:b1` },
            { type: 'url', label: 'Shop', url: 'https://shop' },
          ],
        },
      ],
    ])
    const payload = (calls[1]?.args[1] as { buttons: { payload?: string }[] }).buttons[0]?.payload ?? ''
    expect(decodePostback(payload)).toMatchObject({ kind: 'run', runId: run.id })
    const rows = await db.select().from(messages).where(inArray(messages.id, ids))
    expect(rows.every((r) => r.status === 'sent' && r.sentAt?.getTime() === NOW.getTime())).toBe(true)
  })

  it('skips messages that are no longer queued', async () => {
    const { deps, adapters, queue } = await setup()
    const ids = await queue({ kind: 'dm', body: text('once') })
    await handleOutbound(deps, { messageIds: ids })
    await handleOutbound(deps, { messageIds: ids })
    expect(adapters.instagram.sent('sendMessage')).toHaveLength(1)
  })

  it('refuses DMs outside the 24h window', async () => {
    const { db, deps, adapters, run, queue, statuses } = await setup({
      lastInboundAt: new Date(NOW.getTime() - 25 * 3_600_000),
    })
    const ids = await queue({ kind: 'dm', body: text('late') }, { kind: 'dm', body: text('later') })
    await handleOutbound(deps, { messageIds: ids })
    expect(adapters.instagram.sent('sendMessage')).toEqual([])
    expect(await statuses(ids)).toEqual([
      [ids[0], 'failed', 'window_closed'],
      [ids[1], 'failed', 'skipped'],
    ])
    const [after] = await db.select().from(flowRuns).where(eq(flowRuns.id, run.id))
    expect(after).toMatchObject({ status: 'expired', error: 'window_closed' })
  })

  it('sends private and public comment replies without a DM window', async () => {
    const { deps, adapters, queue } = await setup({ lastInboundAt: null })
    const ids = await queue(
      { kind: 'comment_reply', commentId: 'c1', body: { type: 'comment', text: 'Check DMs' } },
      { kind: 'private_reply', commentId: 'c1', body: text('Tap below') },
    )
    await handleOutbound(deps, { messageIds: ids })
    expect(adapters.instagram.sent().map((c) => [c.method, c.args[0]])).toEqual([
      ['replyToComment', 'c1'],
      ['sendPrivateReply', 'c1'],
    ])
  })

  it('reauth errors flag the account and fail the run', async () => {
    const { db, deps, adapters, account, run, queue, statuses } = await setup()
    adapters.instagram.errors.push(new MetaError('reauth', 'expired', { reason: 'token_invalid' }))
    const ids = await queue({ kind: 'dm', body: text('hi') })
    await expect(handleOutbound(deps, { messageIds: ids })).resolves.toEqual({ status: 'done' })
    expect(await statuses(ids)).toEqual([[ids[0], 'failed', 'token_invalid']])
    const [acct] = await db.select().from(connectedAccounts).where(eq(connectedAccounts.id, account.id))
    expect(acct?.status).toBe('reauth_required')
    const [after] = await db.select().from(flowRuns).where(eq(flowRuns.id, run.id))
    expect(after).toMatchObject({ status: 'failed', error: 'token_invalid' })
  })

  it('rethrows retryable errors until the final attempt', async () => {
    const { db, deps, adapters, run, queue, statuses } = await setup()
    const ids = await queue({ kind: 'dm', body: text('hi') })
    adapters.instagram.errors.push(new MetaError('retryable', 'rate limited', { reason: 'rate_limited' }))
    await expect(handleOutbound(deps, { messageIds: ids })).rejects.toThrow('rate limited')
    expect(await statuses(ids)).toEqual([[ids[0], 'queued', null]])

    adapters.instagram.errors.push(new MetaError('retryable', 'rate limited', { reason: 'rate_limited' }))
    await handleOutbound(deps, { messageIds: ids }, { isFinal: true })
    expect(await statuses(ids)).toEqual([[ids[0], 'failed', 'rate_limited']])
    const [after] = await db.select().from(flowRuns).where(eq(flowRuns.id, run.id))
    expect(after?.status).toBe('failed')
  })

  it('waits when the account is rate limited', async () => {
    const { deps, adapters, queue, statuses } = await setup()
    const ids = await queue({ kind: 'dm', body: text('hi') })
    deps.rateLimiter = { take: async () => 400 }
    expect(await handleOutbound(deps, { messageIds: ids })).toEqual({ status: 'rate_limited', retryInMs: 400 })
    expect(adapters.instagram.sent()).toEqual([])
    expect(await statuses(ids)).toEqual([[ids[0], 'queued', null]])
  })

  it('counts each contact once per month', async () => {
    const { db, deps, clock, account, contact, queue } = await setup()
    await handleOutbound(deps, { messageIds: await queue({ kind: 'dm', body: text('a') }, { kind: 'dm', body: text('b') }) })
    const usage = () =>
      db
        .select()
        .from(usageCounters)
        .where(eq(usageCounters.workspaceId, account.workspaceId))
        .then((rows) => Object.fromEntries(rows.map((r) => [r.period, r.contactsReached])))
    expect(await usage()).toEqual({ '2026-10': 1 })

    clock.now = new Date('2026-11-02T10:00:00Z')
    await db.update(contacts).set({ lastInboundAt: clock.now }).where(eq(contacts.id, contact.id))
    await handleOutbound(deps, { messageIds: await queue({ kind: 'dm', body: text('c') }) })
    expect(await usage()).toEqual({ '2026-10': 1, '2026-11': 1 })
    const [row] = await db.select().from(contacts).where(and(eq(contacts.id, contact.id)))
    expect(row?.lastCountedPeriod).toBe('2026-11')
  })
})
```

`apps/worker/test/rate-limit.test.ts`:
```ts
import { Redis } from 'ioredis'
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { inject } from 'vitest'
import { createRedisRateLimiter } from '../src/rate-limit'

const redis = new Redis(inject('redisUrl'))
afterAll(async () => {
  await redis.quit()
})

describe('createRedisRateLimiter', () => {
  it('allows N calls per second per key', async () => {
    const limiter = createRedisRateLimiter(redis, 2)
    const key = randomUUID()
    const results = [await limiter.take(key), await limiter.take(key), await limiter.take(key)]
    expect(results.slice(0, 2)).toEqual([0, 0])
    expect(results[2]).toBeGreaterThan(0)
    expect(results[2]).toBeLessThanOrEqual(1000)
    expect(await limiter.take(randomUUID())).toBe(0)
  })
})
```

> If the three `take` calls straddle a second boundary, the third can return 0. If that test turns out flaky, wait until just after a second boundary before the calls (`await new Promise((r) => setTimeout(r, 1000 - (Date.now() % 1000) + 5))`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @replyooo/worker test outbound rate-limit`
Expected: FAIL. The modules don't exist yet.

- [ ] **Step 3: Implement**

`apps/worker/src/rate-limit.ts`:
```ts
import type { Redis } from 'ioredis'
import type { RateLimiter } from './deps'

/** Fixed one-second window per key. Good enough to stay under Meta's per-account send limits. */
export function createRedisRateLimiter(redis: Redis, perSecond: number): RateLimiter {
  return {
    async take(key) {
      const now = Date.now()
      const redisKey = `ratelimit:${key}:${Math.floor(now / 1000)}`
      const count = await redis.incr(redisKey)
      if (count === 1) await redis.pexpire(redisKey, 2000)
      return count <= perSecond ? 0 : 1000 - (now % 1000)
    },
  }
}
```

`apps/worker/src/outbound.ts`:
```ts
import type { Db } from '@replyooo/db'
import { connectedAccounts, contacts, messages, usageCounters } from '@replyooo/db'
import type { AccountCredentials, PlatformAdapter, SendableMessage, SendResult } from '@replyooo/meta'
import { MetaError } from '@replyooo/meta'
import { encodePostback } from '@replyooo/shared'
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import type { Deps, OutboundJobData } from './deps'
import type { OutboundBody } from './flow'
import type { ContactRow } from './records'
import { credentials, endRun, markReauthRequired } from './records'

export const DM_WINDOW_MS = 24 * 60 * 60 * 1000

export type OutboundResult = { status: 'done' } | { status: 'rate_limited'; retryInMs: number }

type MessageRow = typeof messages.$inferSelect

export async function handleOutbound(
  deps: Deps,
  job: OutboundJobData,
  attempt: { isFinal: boolean } = { isFinal: false },
): Promise<OutboundResult> {
  const { db } = deps
  for (const [index, id] of job.messageIds.entries()) {
    const [row] = await db
      .select({ message: messages, contact: contacts, account: connectedAccounts })
      .from(messages)
      .innerJoin(contacts, eq(messages.contactId, contacts.id))
      .innerJoin(connectedAccounts, eq(messages.connectedAccountId, connectedAccounts.id))
      .where(eq(messages.id, id))
    if (!row || row.message.status !== 'queued') continue
    const { message, contact, account } = row
    const now = deps.now()

    const stop = async (reason: string, runStatus: 'failed' | 'expired'): Promise<OutboundResult> => {
      await failMessages(db, [id], reason)
      await failMessages(db, job.messageIds.slice(index + 1), 'skipped')
      if (message.flowRunId) await endRun(db, message.flowRunId, runStatus, reason, now)
      return { status: 'done' }
    }

    if (account.status !== 'active') return stop('account_inactive', 'failed')
    if (message.kind === 'dm' && !withinWindow(contact.lastInboundAt, now)) return stop('window_closed', 'expired')

    const waitMs = await deps.rateLimiter.take(account.id)
    if (waitMs > 0) return { status: 'rate_limited', retryInMs: waitMs }

    try {
      const result = await send(deps.adapters[account.platform], credentials(account, deps.tokenKey), contact, message)
      await db
        .update(messages)
        .set({ status: 'sent', externalId: result.messageId, sentAt: now, error: null })
        .where(and(eq(messages.id, id), eq(messages.status, 'queued')))
      await countUsage(db, account.workspaceId, contact.id, now)
    } catch (error) {
      if (!(error instanceof MetaError)) throw error
      if (error.kind === 'retryable' && !attempt.isFinal) throw error
      if (error.kind === 'reauth') await markReauthRequired(db, account.id)
      const reason = error.details.reason ?? error.kind
      return stop(reason, reason === 'window_closed' ? 'expired' : 'failed')
    }
  }
  return { status: 'done' }
}

function withinWindow(lastInboundAt: Date | null, now: Date): boolean {
  return lastInboundAt !== null && now.getTime() - lastInboundAt.getTime() <= DM_WINDOW_MS
}

async function failMessages(db: Db, ids: string[], error: string): Promise<void> {
  if (ids.length === 0) return
  await db
    .update(messages)
    .set({ status: 'failed', error })
    .where(and(inArray(messages.id, ids), eq(messages.status, 'queued')))
}

export function toSendable(body: OutboundBody, runId: string | null): SendableMessage {
  if (body.type === 'image') return { kind: 'image', url: body.url }
  if (body.type === 'comment') return { kind: 'text', text: body.text }
  const buttons = (body.message.buttons ?? []).flatMap((button) => {
    if (button.type === 'url') return [{ type: 'url' as const, label: button.label, url: button.url }]
    if (!runId) return []
    const payload = encodePostback({ kind: 'run', runId, stepId: button.stepId, buttonId: button.buttonId })
    return [{ type: 'postback' as const, label: button.label, payload }]
  })
  return buttons.length > 0 ? { kind: 'text', text: body.message.text, buttons } : { kind: 'text', text: body.message.text }
}

async function send(
  adapter: PlatformAdapter,
  account: AccountCredentials,
  contact: ContactRow,
  message: MessageRow,
): Promise<SendResult> {
  const body = message.body as unknown as OutboundBody
  switch (message.kind) {
    case 'dm':
      return adapter.sendMessage(account, contact.platformUserId, toSendable(body, message.flowRunId))
    case 'private_reply':
      return adapter.sendPrivateReply(account, requireCommentId(message), toSendable(body, message.flowRunId))
    case 'comment_reply':
      return adapter.replyToComment(account, requireCommentId(message), body.type === 'comment' ? body.text : '')
    default:
      throw new Error(`Cannot send a message of kind ${message.kind}`)
  }
}

function requireCommentId(message: MessageRow): string {
  if (!message.commentId) throw new Error(`Message ${message.id} has no comment id`)
  return message.commentId
}

/** Counts a contact once per UTC month, on its first successful outbound message. */
export async function countUsage(db: Db, workspaceId: string, contactId: string, now: Date): Promise<void> {
  const period = now.toISOString().slice(0, 7)
  await db.transaction(async (tx) => {
    const claimed = await tx
      .update(contacts)
      .set({ lastCountedPeriod: period })
      .where(and(eq(contacts.id, contactId), or(isNull(contacts.lastCountedPeriod), ne(contacts.lastCountedPeriod, period))))
      .returning({ id: contacts.id })
    if (claimed.length === 0) return
    await tx
      .insert(usageCounters)
      .values({ workspaceId, period, contactsReached: 1 })
      .onConflictDoUpdate({
        target: [usageCounters.workspaceId, usageCounters.period],
        set: { contactsReached: sql`${usageCounters.contactsReached} + 1`, updatedAt: now },
      })
  })
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @replyooo/worker test outbound rate-limit && pnpm --filter @replyooo/worker typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): send outbound messages with window checks, rate limits and usage counting"
```

---

### Task 15: Worker: maintenance (sweeper, token refresh, retention)

**Files:**
- Create: `apps/worker/src/maintenance.ts`
- Test: `apps/worker/test/maintenance.test.ts`

**Interfaces:**
- Produces:
  ```ts
  const SWEEP_BATCH = 500
  function sweep(deps: Deps): Promise<{ timeouts: number; starts: number; messages: number; events: number }>
  function refreshExpiringTokens(deps: Deps): Promise<{ refreshed: number; failed: number }>
  function pruneWebhookEvents(deps: Deps): Promise<number>
  ```
  `sweep` re-enqueues (no job IDs; `expectedVersion` and `queued` status make duplicates harmless):
  - `waiting` runs with `wait_until` more than 30s ago → `flow` timeout job with `expectedVersion`.
  - `running` runs at `state_version = 0` created more than 2 min ago (lost start job) → `flow` start job from `trigger_ref`.
  - outbound `queued` messages created more than 5 min ago → `outbound` jobs grouped by run, oldest first.
  - `webhook_events` with no `processed_at`, received between 24h and 2 min ago → `inbound` jobs.

  `refreshExpiringTokens`: active Instagram accounts whose `token_expires_at` is within 10 days → `adapter.refreshToken`, store the encrypted new token and expiry. `reauth` errors flag the account; other errors are logged and counted.
  `pruneWebhookEvents`: deletes events received more than 30 days ago.

- [ ] **Step 1: Write the failing test**

`apps/worker/test/maintenance.test.ts`:
```ts
import { connectedAccounts, decryptToken, flowRuns, messages, webhookEvents } from '@replyooo/db'
import { MetaError } from '@replyooo/meta'
import type { FlowDefinition } from '@replyooo/shared'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { pruneWebhookEvents, refreshExpiringTokens, sweep } from '../src/maintenance'
import {
  createTestContext,
  dm,
  insertRun,
  NOW,
  publishAutomation,
  seedAccount,
  seedContact,
  TOKEN_KEY,
} from './support'

const flow: FlowDefinition = {
  trigger: { type: 'any_dm' },
  start: 's1',
  steps: { s1: { type: 'send_message', text: 'hi' } },
}
const ago = (ms: number) => new Date(NOW.getTime() - ms)

async function setup() {
  const ctx = createTestContext()
  const db = ctx.deps.db
  const { account } = await seedAccount(db)
  const published = await publishAutomation(db, account, flow)
  const contact = await seedContact(db, account)
  return { ...ctx, db, refs: { account, contact, ...published } }
}

describe('sweep', () => {
  it('re-enqueues overdue timeouts and lost starts', async () => {
    const { db, deps, jobs, refs } = await setup()
    const overdue = await insertRun(db, refs, { status: 'waiting', wait: { kind: 'delay' }, waitUntil: ago(60_000), stateVersion: 4 })
    const fresh = await insertRun(
      db,
      { ...refs, contact: await seedContact(db, refs.account) },
      { status: 'waiting', wait: { kind: 'delay' }, waitUntil: ago(5_000), stateVersion: 1 },
    )
    const lost = await insertRun(db, { ...refs, contact: await seedContact(db, refs.account) })
    const trigger = { kind: 'dm', text: 'hi' }
    await db.update(flowRuns).set({ createdAt: ago(5 * 60_000), triggerRef: trigger }).where(eq(flowRuns.id, lost.id))

    await sweep(deps)
    const byRun = (id: string) => jobs.flows.filter((j) => j.data.runId === id).map((j) => j.data)
    expect(byRun(overdue.id)).toEqual([{ runId: overdue.id, event: { type: 'timeout' }, expectedVersion: 4 }])
    expect(byRun(fresh.id)).toEqual([])
    expect(byRun(lost.id)).toEqual([{ runId: lost.id, event: { type: 'start', trigger }, expectedVersion: 0 }])
  })

  it('re-enqueues stuck outbound messages grouped by run, oldest first', async () => {
    const { db, deps, jobs, refs } = await setup()
    const run = await insertRun(db, refs, { status: 'completed' })
    const insert = async (createdAt: Date) => {
      const [row] = await db
        .insert(messages)
        .values({
          contactId: refs.contact.id,
          connectedAccountId: refs.account.id,
          flowRunId: run.id,
          direction: 'out',
          kind: 'dm',
          body: { type: 'message', message: { text: 'x' } },
          status: 'queued',
          createdAt,
        })
        .returning({ id: messages.id })
      return row!.id
    }
    const first = await insert(ago(10 * 60_000))
    const second = await insert(ago(9 * 60_000))
    const recent = await insert(ago(60_000))
    await sweep(deps)
    const mine = jobs.outbounds.find((j) => j.messageIds.includes(first))
    expect(mine?.messageIds).toEqual([first, second])
    expect(jobs.outbounds.some((j) => j.messageIds.includes(recent))).toBe(false)
  })

  it('re-enqueues unprocessed webhook events from the last day', async () => {
    const { db, deps, jobs, refs } = await setup()
    const insert = async (receivedAt: Date) => {
      const event = dm(refs.account, 'u1', 'hi')
      const [row] = await db
        .insert(webhookEvents)
        .values({ platform: 'instagram', dedupKey: event.dedupKey, payload: event, receivedAt })
        .returning({ id: webhookEvents.id })
      return row!.id
    }
    const stuck = await insert(ago(10 * 60_000))
    const recent = await insert(ago(30_000))
    const ancient = await insert(ago(2 * 86_400_000))
    await sweep(deps)
    expect(jobs.inbounds).toContain(stuck)
    expect(jobs.inbounds).not.toContain(recent)
    expect(jobs.inbounds).not.toContain(ancient)
  })
})

describe('refreshExpiringTokens', () => {
  it('refreshes Instagram tokens expiring within 10 days', async () => {
    const ctx = createTestContext()
    const db = ctx.deps.db
    const { account: expiring } = await seedAccount(db, { tokenExpiresAt: new Date(NOW.getTime() + 5 * 86_400_000) })
    const { account: later } = await seedAccount(db, { tokenExpiresAt: new Date(NOW.getTime() + 30 * 86_400_000) })
    await refreshExpiringTokens(ctx.deps)
    const [a] = await db.select().from(connectedAccounts).where(eq(connectedAccounts.id, expiring.id))
    expect(decryptToken(a!.accessTokenEnc, TOKEN_KEY)).toBe('token-abc-refreshed')
    expect(a!.tokenExpiresAt).toEqual(new Date(NOW.getTime() + 60 * 86_400_000))
    const [b] = await db.select().from(connectedAccounts).where(eq(connectedAccounts.id, later.id))
    expect(b!.accessTokenEnc).toBe(later.accessTokenEnc)
  })

  it('flags accounts whose token can no longer be refreshed', async () => {
    const ctx = createTestContext()
    const db = ctx.deps.db
    const { account } = await seedAccount(db, { tokenExpiresAt: new Date(NOW.getTime() + 86_400_000) })
    // Earlier tests may have left other expiring accounts; give every refresh a reauth error.
    for (let i = 0; i < 50; i++) ctx.adapters.instagram.errors.push(new MetaError('reauth', 'revoked'))
    await refreshExpiringTokens(ctx.deps)
    const [row] = await db.select().from(connectedAccounts).where(eq(connectedAccounts.id, account.id))
    expect(row?.status).toBe('reauth_required')
  })
})

describe('pruneWebhookEvents', () => {
  it('deletes events older than 30 days', async () => {
    const ctx = createTestContext()
    const db = ctx.deps.db
    const insert = async (receivedAt: Date) => {
      const [row] = await db
        .insert(webhookEvents)
        .values({ platform: 'instagram', dedupKey: `t:${randomUUID()}`, payload: {}, receivedAt, processedAt: receivedAt })
        .returning({ id: webhookEvents.id })
      return row!.id
    }
    const old = await insert(ago(31 * 86_400_000))
    const kept = await insert(ago(29 * 86_400_000))
    await pruneWebhookEvents(ctx.deps)
    const ids = (await db.select({ id: webhookEvents.id }).from(webhookEvents)).map((r) => r.id)
    expect(ids).not.toContain(old)
    expect(ids).toContain(kept)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @replyooo/worker test maintenance`
Expected: FAIL. `../src/maintenance` doesn't exist yet.

- [ ] **Step 3: Implement**

`apps/worker/src/maintenance.ts`:
```ts
import { connectedAccounts, encryptToken, flowRuns, messages, webhookEvents } from '@replyooo/db'
import type { StartTrigger } from '@replyooo/engine'
import { MetaError } from '@replyooo/meta'
import { and, asc, eq, gt, isNull, lt } from 'drizzle-orm'
import type { Deps } from './deps'
import { credentials, markReauthRequired } from './records'

export const SWEEP_BATCH = 500
const SECOND = 1000
const MINUTE = 60 * SECOND
const DAY = 24 * 60 * MINUTE

export async function sweep(deps: Deps) {
  const { db, jobs } = deps
  const now = deps.now().getTime()
  const ago = (ms: number) => new Date(now - ms)

  const overdue = await db
    .select({ id: flowRuns.id, stateVersion: flowRuns.stateVersion })
    .from(flowRuns)
    .where(and(eq(flowRuns.status, 'waiting'), lt(flowRuns.waitUntil, ago(30 * SECOND))))
    .limit(SWEEP_BATCH)
  for (const run of overdue) {
    await jobs.flow({ runId: run.id, event: { type: 'timeout' }, expectedVersion: run.stateVersion })
  }

  const lost = await db
    .select({ id: flowRuns.id, triggerRef: flowRuns.triggerRef })
    .from(flowRuns)
    .where(and(eq(flowRuns.status, 'running'), eq(flowRuns.stateVersion, 0), lt(flowRuns.createdAt, ago(2 * MINUTE))))
    .limit(SWEEP_BATCH)
  let starts = 0
  for (const run of lost) {
    if (!run.triggerRef) continue
    const trigger = run.triggerRef as unknown as StartTrigger
    await jobs.flow({ runId: run.id, event: { type: 'start', trigger }, expectedVersion: 0 })
    starts++
  }

  const stuck = await db
    .select({ id: messages.id, flowRunId: messages.flowRunId })
    .from(messages)
    .where(and(eq(messages.status, 'queued'), eq(messages.direction, 'out'), lt(messages.createdAt, ago(5 * MINUTE))))
    .orderBy(asc(messages.createdAt), asc(messages.id))
    .limit(SWEEP_BATCH)
  const groups = new Map<string, string[]>()
  for (const message of stuck) {
    const key = message.flowRunId ?? message.id
    groups.set(key, [...(groups.get(key) ?? []), message.id])
  }
  for (const messageIds of groups.values()) await jobs.outbound({ messageIds })

  const events = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(
      and(
        isNull(webhookEvents.processedAt),
        lt(webhookEvents.receivedAt, ago(2 * MINUTE)),
        gt(webhookEvents.receivedAt, ago(DAY)),
      ),
    )
    .limit(SWEEP_BATCH)
  for (const event of events) await jobs.inbound(event.id)

  const result = { timeouts: overdue.length, starts, messages: stuck.length, events: events.length }
  if (Object.values(result).some((n) => n > 0)) deps.log.info(result, 'sweeper re-enqueued work')
  return result
}

export async function refreshExpiringTokens(deps: Deps) {
  const { db } = deps
  const now = deps.now()
  const accounts = await db
    .select()
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.status, 'active'),
        eq(connectedAccounts.platform, 'instagram'),
        lt(connectedAccounts.tokenExpiresAt, new Date(now.getTime() + 10 * DAY)),
      ),
    )
  let refreshed = 0
  let failed = 0
  for (const account of accounts) {
    try {
      const result = await deps.adapters.instagram.refreshToken(credentials(account, deps.tokenKey))
      await db
        .update(connectedAccounts)
        .set({ accessTokenEnc: encryptToken(result.accessToken, deps.tokenKey), tokenExpiresAt: result.expiresAt })
        .where(eq(connectedAccounts.id, account.id))
      refreshed++
    } catch (error) {
      failed++
      if (error instanceof MetaError && error.kind === 'reauth') await markReauthRequired(db, account.id)
      deps.log.warn({ err: error, accountId: account.id }, 'token refresh failed')
    }
  }
  return { refreshed, failed }
}

export async function pruneWebhookEvents(deps: Deps): Promise<number> {
  const cutoff = new Date(deps.now().getTime() - 30 * DAY)
  const deleted = await deps.db
    .delete(webhookEvents)
    .where(lt(webhookEvents.receivedAt, cutoff))
    .returning({ id: webhookEvents.id })
  return deleted.length
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @replyooo/worker test maintenance && pnpm --filter @replyooo/worker typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): add sweeper, token refresh and webhook retention"
```

---

### Task 16: Worker: BullMQ wiring, entry point and end-to-end test

**Files:**
- Create: `apps/worker/src/queues.ts`, `apps/worker/src/main.ts`
- Test: `apps/worker/test/e2e.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type QueueName = 'inbound' | 'flow' | 'outbound' | 'maintenance'
  type Queues = Record<QueueName, Queue>
  function createQueues(redisUrl: string, prefix?: string): Queues
  function closeQueues(queues: Queues): Promise<void>
  function createBullJobs(queues: Queues): Jobs
  function startWorkers(deps: Deps, redisUrl: string, opts?: { prefix?: string; concurrency?: number }): Worker[]
  function scheduleMaintenance(queues: Queues): Promise<void>
  ```
  Job options: 5 attempts, exponential backoff from 2s, completed jobs kept 1h / 1000, failed jobs kept 7 days. Maintenance jobs get 1 attempt. Job names: `inbound` (jobId `inbound-<eventId>`), `advance` and `follow_check` on `flow`, `send` on `outbound`, `sweep` / `refresh-tokens` / `prune-webhooks` on `maintenance` (job schedulers: every 60s, `0 3 * * *`, `30 3 * * *`). The outbound worker passes `isFinal = attemptsMade + 1 >= attempts`. On `rate_limited` it calls `job.moveToDelayed(...)` and throws `DelayedError`.

- [ ] **Step 1: Write the failing end-to-end test**

`apps/worker/test/e2e.test.ts`:
```ts
import { contacts, flowRuns, messages } from '@replyooo/db'
import { createFacebookAdapter, createInstagramAdapter } from '@replyooo/meta'
import type { FlowDefinition } from '@replyooo/shared'
import type { Worker } from 'bullmq'
import { and, eq } from 'drizzle-orm'
import { Redis } from 'ioredis'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { createHmac, randomUUID } from 'node:crypto'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import type { Deps } from '../src/deps'
import type { Queues } from '../src/queues'
import { closeQueues, createBullJobs, createQueues, startWorkers } from '../src/queues'
import { createRedisRateLimiter } from '../src/rate-limit'
import { createServer } from '../src/server'
import { publishAutomation, seedAccount, TOKEN_KEY, useDb } from './support'

const graph = 'https://graph.instagram.com/v24.0'
const SECRET = 'ig-secret'
const sent: { path: string; body: any }[] = []
const msw = setupServer(
  http.post(`${graph}/:id/messages`, async ({ request }) => {
    sent.push({ path: 'messages', body: await request.json() })
    return HttpResponse.json({ message_id: `mid.out.${sent.length}` })
  }),
  http.post(`${graph}/:id/replies`, async ({ request, params }) => {
    sent.push({ path: `replies:${params.id}`, body: await request.json() })
    return HttpResponse.json({ id: `reply.${sent.length}` })
  }),
  http.get(`${graph}/:id`, () => HttpResponse.json({ name: 'Priya Sharma', username: 'priya' })),
)

const flow: FlowDefinition = {
  trigger: {
    type: 'comment_keyword',
    posts: { mode: 'any' },
    keywords: ['guide'],
    match: 'contains',
    publicReplies: ['Check your DMs!'],
  },
  start: 's1',
  steps: {
    s1: { type: 'send_message', text: 'Tap below for the guide', buttons: [{ type: 'reply', id: 'b1', label: 'Send it', next: 's2' }] },
    s2: { type: 'send_message', text: 'Here you go: https://example.com/guide' },
  },
}

let queues: Queues
let workers: Worker[]
let redis: Redis
let deps: Deps

beforeAll(() => {
  msw.listen({ onUnhandledFrame: 'error' })
  const redisUrl = inject('redisUrl')
  const prefix = `e2e-${randomUUID()}`
  redis = new Redis(redisUrl)
  queues = createQueues(redisUrl, prefix)
  deps = {
    db: useDb(),
    jobs: createBullJobs(queues),
    adapters: { instagram: createInstagramAdapter(), facebook: createFacebookAdapter() },
    rateLimiter: createRedisRateLimiter(redis, 50),
    tokenKey: TOKEN_KEY,
    log: pino({ level: 'silent' }),
    now: () => new Date(),
  }
  workers = startWorkers(deps, redisUrl, { prefix, concurrency: 2 })
})

afterAll(async () => {
  await Promise.all(workers.map((w) => w.close()))
  await closeQueues(queues)
  await redis.quit()
  msw.close()
})

async function waitFor<T>(check: () => Promise<T | undefined | false>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 100))
  }
}

describe('worker end to end', () => {
  it('comment → public reply + private reply → tap → DM, with duplicates ignored', async () => {
    const db = deps.db
    const { account } = await seedAccount(db)
    await publishAutomation(db, account, flow)
    const app = createServer(deps, { verifyToken: 'v', appSecrets: [SECRET] })
    const post = (payload: unknown) => {
      const body = JSON.stringify(payload)
      const signature = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`
      return app.request('/webhooks/meta', { method: 'POST', body, headers: { 'x-hub-signature-256': signature } })
    }
    const commentId = `c_${randomUUID()}`
    const commentWebhook = {
      object: 'instagram',
      entry: [
        {
          id: account.externalId,
          time: Math.floor(Date.now() / 1000),
          changes: [
            {
              field: 'comments',
              value: { id: commentId, text: 'GUIDE please', from: { id: 'igsid_e2e', username: 'priya' }, media: { id: 'm1' } },
            },
          ],
        },
      ],
    }

    expect((await post(commentWebhook)).status).toBe(200)
    await waitFor(async () => sent.length >= 2)
    expect(sent.find((s) => s.path === `replies:${commentId}`)?.body).toEqual({ message: 'Check your DMs!' })
    const privateReply = sent.find((s) => s.path === 'messages')!
    expect(privateReply.body.recipient).toEqual({ comment_id: commentId })
    const payload: string = privateReply.body.message.attachment.payload.buttons[0].payload

    // Meta redelivers the same comment: nothing new happens.
    expect((await post(commentWebhook)).status).toBe(200)

    const now = Date.now()
    expect(
      (
        await post({
          object: 'instagram',
          entry: [
            {
              id: account.externalId,
              time: now,
              messaging: [
                {
                  sender: { id: 'igsid_e2e' },
                  recipient: { id: account.externalId },
                  timestamp: now,
                  postback: { mid: `mid.${randomUUID()}`, title: 'Send it', payload },
                },
              ],
            },
          ],
        })
      ).status,
    ).toBe(200)

    const [contact] = await waitFor(async () => {
      const rows = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.connectedAccountId, account.id), eq(contacts.platformUserId, 'igsid_e2e')))
      return rows.length > 0 && rows
    })
    const runs = await waitFor(async () => {
      const rows = await db.select().from(flowRuns).where(eq(flowRuns.contactId, contact!.id))
      return rows[0]?.status === 'completed' && rows
    })
    expect(runs).toHaveLength(1)
    await waitFor(async () => sent.length >= 3)
    expect(sent[2]?.body).toEqual({
      recipient: { id: 'igsid_e2e' },
      message: { text: 'Here you go: https://example.com/guide' },
    })

    const outbound = await db
      .select()
      .from(messages)
      .where(and(eq(messages.contactId, contact!.id), eq(messages.direction, 'out')))
    expect(outbound.map((m) => [m.kind, m.status]).sort()).toEqual(
      [
        ['comment_reply', 'sent'],
        ['dm', 'sent'],
        ['private_reply', 'sent'],
      ].sort(),
    )
    await new Promise((r) => setTimeout(r, 500))
    expect(sent).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @replyooo/worker test e2e`
Expected: FAIL. `../src/queues` doesn't exist yet.

- [ ] **Step 3: Implement**

`apps/worker/src/queues.ts`:
```ts
import { DelayedError, type Job, type JobsOptions, Queue, Worker } from 'bullmq'
import type { Deps, FlowJobData, FollowCheckJobData, Jobs, OutboundJobData } from './deps'
import { handleFlowJob, handleFollowCheck } from './flow'
import { handleInbound } from './inbound'
import { pruneWebhookEvents, refreshExpiringTokens, sweep } from './maintenance'
import { handleOutbound } from './outbound'

export type QueueName = 'inbound' | 'flow' | 'outbound' | 'maintenance'
export type Queues = Record<QueueName, Queue>

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
}

export function createQueues(redisUrl: string, prefix?: string): Queues {
  const options = { connection: { url: redisUrl }, defaultJobOptions, ...(prefix ? { prefix } : {}) }
  return {
    inbound: new Queue('inbound', options),
    flow: new Queue('flow', options),
    outbound: new Queue('outbound', options),
    maintenance: new Queue('maintenance', { ...options, defaultJobOptions: { ...defaultJobOptions, attempts: 1 } }),
  }
}

export async function closeQueues(queues: Queues): Promise<void> {
  await Promise.all(Object.values(queues).map((queue) => queue.close()))
}

export function createBullJobs(queues: Queues): Jobs {
  return {
    async inbound(webhookEventId) {
      await queues.inbound.add('inbound', { webhookEventId }, { jobId: `inbound-${webhookEventId}` })
    },
    async flow(data, opts) {
      await queues.flow.add('advance', data, {
        ...(opts?.at ? { delay: Math.max(0, opts.at.getTime() - Date.now()) } : {}),
        ...(opts?.jobId ? { jobId: opts.jobId } : {}),
      })
    },
    async followCheck(data) {
      await queues.flow.add('follow_check', data)
    },
    async outbound(data) {
      await queues.outbound.add('send', data)
    },
  }
}

export function startWorkers(
  deps: Deps,
  redisUrl: string,
  opts: { prefix?: string; concurrency?: number } = {},
): Worker[] {
  const base = {
    connection: { url: redisUrl, maxRetriesPerRequest: null },
    concurrency: opts.concurrency ?? 10,
    ...(opts.prefix ? { prefix: opts.prefix } : {}),
  }

  const workers = [
    new Worker('inbound', async (job: Job<{ webhookEventId: string }>) => handleInbound(deps, job.data.webhookEventId), base),
    new Worker(
      'flow',
      async (job: Job<FlowJobData | FollowCheckJobData>) => {
        if (job.name === 'follow_check') await handleFollowCheck(deps, job.data as FollowCheckJobData)
        else await handleFlowJob(deps, job.data as FlowJobData)
      },
      base,
    ),
    new Worker(
      'outbound',
      async (job: Job<OutboundJobData>, token?: string) => {
        const isFinal = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)
        const result = await handleOutbound(deps, job.data, { isFinal })
        if (result.status === 'rate_limited') {
          await job.moveToDelayed(Date.now() + result.retryInMs, token)
          throw new DelayedError()
        }
      },
      base,
    ),
    new Worker(
      'maintenance',
      async (job: Job) => {
        switch (job.name) {
          case 'sweep':
            return sweep(deps)
          case 'refresh-tokens':
            return refreshExpiringTokens(deps)
          case 'prune-webhooks':
            return pruneWebhookEvents(deps)
        }
      },
      { ...base, concurrency: 1 },
    ),
  ]
  for (const worker of workers) {
    worker.on('failed', (job, err) =>
      deps.log.error({ err, queue: worker.name, jobId: job?.id, attempts: job?.attemptsMade }, 'job failed'),
    )
  }
  return workers
}

export async function scheduleMaintenance(queues: Queues): Promise<void> {
  await queues.maintenance.upsertJobScheduler('sweep', { every: 60_000 }, { name: 'sweep' })
  await queues.maintenance.upsertJobScheduler('refresh-tokens', { pattern: '0 3 * * *' }, { name: 'refresh-tokens' })
  await queues.maintenance.upsertJobScheduler('prune-webhooks', { pattern: '30 3 * * *' }, { name: 'prune-webhooks' })
}
```

`apps/worker/src/main.ts`:
```ts
import { serve } from '@hono/node-server'
import { createDb, parseEncryptionKey } from '@replyooo/db'
import { createFacebookAdapter, createInstagramAdapter } from '@replyooo/meta'
import { Redis } from 'ioredis'
import type { Deps } from './deps'
import { loadEnv } from './env'
import { createLogger } from './logger'
import { closeQueues, createBullJobs, createQueues, scheduleMaintenance, startWorkers } from './queues'
import { createRedisRateLimiter } from './rate-limit'
import { createServer } from './server'

const env = loadEnv()
const log = createLogger(env.LOG_LEVEL)
const { db, close: closeDb } = createDb(env.DATABASE_URL)
const redis = new Redis(env.REDIS_URL)
const queues = createQueues(env.REDIS_URL)

const deps: Deps = {
  db,
  jobs: createBullJobs(queues),
  adapters: {
    instagram: createInstagramAdapter({ graphVersion: env.META_GRAPH_VERSION }),
    facebook: createFacebookAdapter({ graphVersion: env.META_GRAPH_VERSION }),
  },
  rateLimiter: createRedisRateLimiter(redis, env.OUTBOUND_RATE_PER_SECOND),
  tokenKey: parseEncryptionKey(env.TOKEN_ENCRYPTION_KEY),
  log,
  now: () => new Date(),
}

const workers = startWorkers(deps, env.REDIS_URL)
await scheduleMaintenance(queues)

const app = createServer(deps, {
  verifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
  appSecrets: [env.META_APP_SECRET, env.INSTAGRAM_APP_SECRET],
})
const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => log.info({ port: info.port }, 'worker listening'))

let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  log.info({ signal }, 'shutting down')
  server.close()
  await Promise.all(workers.map((worker) => worker.close()))
  await closeQueues(queues)
  await redis.quit()
  await closeDb()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @replyooo/worker test && pnpm --filter @replyooo/worker typecheck`
Expected: PASS (every worker test file, including e2e).

- [ ] **Step 5: Smoke-run the worker locally**

Run:
```bash
docker compose up -d
pnpm --filter @replyooo/db db:migrate
TOKEN_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") \
META_APP_SECRET=x INSTAGRAM_APP_SECRET=y META_WEBHOOK_VERIFY_TOKEN=v \
DATABASE_URL=postgres://replyooo:replyooo@localhost:5432/replyooo REDIS_URL=redis://localhost:6379 \
pnpm --filter @replyooo/worker start
```
In a second shell: `curl -s 'localhost:3001/webhooks/meta?hub.mode=subscribe&hub.verify_token=v&hub.challenge=ok'`
Expected: prints `ok`, and the worker logs `worker listening`. Stop it with Ctrl-C. It should log `shutting down` and exit cleanly.

- [ ] **Step 6: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): wire BullMQ queues, workers and process entry point"
```

---

### Final verification

- [ ] Run from the repo root: `pnpm typecheck && pnpm test`
  Expected: every package passes (shared, engine, db, meta, worker).
- [ ] Check the Review Focus list at the top: each item's test exists and passes.
- [ ] Manual E2E against Meta (needs the Meta app in development mode; spec §8). Do this before Plan 3 ships connect-account UI, using a token pasted into `connected_accounts` by hand. Check these against the real payloads the normalizer assumes:
  1. Instagram comment `from.id` equals the IGSID in later DM webhooks for the same person.
  2. Story quick reactions arrive as `message.reply_to.story` with emoji-only text.
  3. Button template private replies render on Instagram and the tap arrives as `messaging_postbacks`.
  4. The window-closed error subcode returned by Instagram (update `WINDOW_SUBCODES` if it differs).
