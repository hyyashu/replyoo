# Re-run on Existing Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Run on existing comments" action that fetches the comments already on a comment automation's post(s) from Meta and runs them through the automation like live webhook comments, to catch up after publishing or recover missed comments.

**Architecture:** The web app inserts a `backfill_runs` row; the worker's 60-second sweep queues it; `handleBackfill` lists comments through a new `listComments` adapter method, drops handled ones, and inserts one `comment_created` event per eligible comment (restricted to this automation) into `webhook_events`, then hands each to the existing inbound job. Routing, contact upsert, entry cooldown, plan limits, flow and outbound are all existing code. The preview in the dialog uses the same gather and classify functions.

**Tech Stack:** TypeScript monorepo (pnpm 10.15, Turborepo), Drizzle ORM 0.45 + drizzle-kit 0.31 on Postgres 18, Hono/BullMQ worker, Next.js 16 (server actions, next-intl), Vitest 5 + Testcontainers (Docker required) + msw for Meta calls.

**Spec:** `docs/superpowers/specs/2026-10-13-rerun-on-existing-comments-design.md`. This plan changes the spec in four small ways, all applied to the spec in Task 7: (1) for "any post" automations, scan the account's 24 most recent posts rather than only posts published in the window, because a recent comment can be on an older post; (2) the gather helper lives in `packages/meta` and the classifier in `packages/engine`, so the web preview and the worker share them; (3) the after-run summary shows the four counts stored on `backfill_runs` (found, queued, already handled, no match) instead of per-comment outcomes; (4) v1 puts the button in the editor only, not the automations list menu. A Meta error fails the run with a reason and the user re-runs; there is no automatic retry.

## Global Constraints

- Code style matches the repo: TypeScript, no semicolons, single quotes, 2-space indent, `import type` for types.
- Instagram private replies: one per comment, only within 7 days of the comment. Window options are 24, 72 or 168 hours, never more.
- A run covers at most 500 comments (`BACKFILL_MAX_COMMENTS`). One queued or running run per automation (partial unique index).
- Backfill events use `dedup_key = backfill:<runId>:<commentId>` and carry `restrictToAutomationId`. Normal webhook events are unchanged.
- "Handled" means: a `flow_runs.comment_id` match for the account, or an outbound (`direction = 'out'`) message with that `comment_id`. An inbound `messages` row (kind `comment`) does **not** mean handled.
- Every user-visible web string goes through next-intl with both `en.json` and `es.json`; `pnpm --filter @replyooo/web translations:check` must pass.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Docker must be running for db, worker and web tests (Testcontainers).

## Review Focus

Inputs and conditions the spec implies but that are easy to get wrong, with the behavior a person expects. Each is pinned by a named test in the owning task.

1. **A comment the webhook already received but that matched nothing** (an inbound `messages` row exists, no run, no reply) must still be eligible for a re-run. Only flow runs and outbound messages count as handled. (Task 1, Task 4)
2. **A comment with no author id** (hidden or restricted user) is skipped without crashing the run. (Task 2)
3. **The same person commenting twice** on a post inside the window gets one DM, not two: the second hits the 24-hour entry cooldown and is dropped quietly. (Task 4)
4. **Double-clicking "Run now"** returns the same active run rather than an error or a second run. (Task 1, Task 5)
5. **Meta fails mid-run** (token revoked): the run ends `failed` with a reason, the account is flagged for reauth, and nothing is left `running`. (Task 4)
6. **Facebook may return comments ranked, not newest-first**: the gather helper filters by time itself and passes `since`, and never stops early on a page that still contains in-window comments. (Task 2)

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/src/schema.ts` (modify) | `backfill_status` enum and `backfill_runs` table |
| `packages/db/src/backfill.ts` (create) | Run lifecycle helpers and `handledCommentIds` |
| `packages/db/src/index.ts` (modify) | Export the new module |
| `packages/db/migrations/0010_*.sql` (generated) | The migration |
| `packages/meta/src/types.ts` (modify) | `CommentItem`, `CommentPage`, `listComments`, `restrictToAutomationId` |
| `packages/meta/src/instagram.ts`, `facebook.ts` (modify) | `listComments` per platform |
| `packages/meta/src/comments.ts` (create) | `collectComments`, `commentTargets`, `gatherComments` |
| `packages/engine/src/backfill.ts` (create) | `classifyComments` |
| `apps/worker/src/backfill.ts` (create) | `handleBackfill` |
| `apps/worker/src/inbound.ts`, `maintenance.ts`, `queues.ts`, `deps.ts` (modify) | Event restriction, sweep pickup, queue wiring |
| `apps/web/src/lib/rerun.ts` (create) | `RERUN_WINDOWS` constant usable by client code |
| `apps/web/src/lib/data/backfill.ts` (create) | Preview, start, latest-run data functions |
| `apps/web/src/app/actions.ts` (modify) | Three server actions |
| `apps/web/src/app/(app)/automations/[id]/rerun-section.tsx` (create) | The section and dialog |
| `apps/web/src/app/(app)/automations/[id]/editor.tsx` (modify) | Render the section |
| `apps/web/messages/en.json`, `es.json` (modify) | Strings |

---

### Task 1: Database tables and helpers

**Files:**
- Modify: `packages/db/src/schema.ts` (append after `linkClicks`)
- Create: `packages/db/src/backfill.ts`
- Modify: `packages/db/src/index.ts`
- Generate: `packages/db/migrations/0010_rerun_comments.sql` (+ snapshot, journal)
- Test: `packages/db/test/backfill.test.ts`

**Interfaces:**
- Consumes: existing `automations`, `connectedAccounts`, `flowRuns`, `messages` tables; `Db` from `./client`.
- Produces (all exported from `@replyooo/db`):
  - `backfillRuns` table, `backfillStatusEnum`, type `BackfillRun`
  - `BACKFILL_WINDOWS_HOURS = [24, 72, 168] as const`, `BACKFILL_MAX_COMMENTS = 500`
  - `createBackfillRun(db, { automationId, connectedAccountId, windowHours }): Promise<{ run: BackfillRun; created: boolean }>`
  - `latestBackfillRun(db, automationId): Promise<BackfillRun | null>`
  - `queuedBackfillRunIds(db, limit): Promise<string[]>` (oldest first)
  - `claimBackfillRun(db, id, now): Promise<BackfillRun | null>` (queued to running, atomic)
  - `finishBackfillRun(db, id, result, now): Promise<void>` where `result` is `{ status: 'done' } & BackfillOutcome | { status: 'failed'; error: string }`
  - `failStuckBackfillRuns(db, now): Promise<number>`
  - `handledCommentIds(db, accountId, commentIds): Promise<Set<string>>`
  - type `BackfillOutcome = { found: number; skippedHandled: number; skippedNoMatch: number; enqueued: number; capped: boolean }`

- [ ] **Step 1: Create the branch**

```bash
cd /Users/hyyashu/Projects/Replyooo && git switch -c feat/rerun-existing-comments
```

- [ ] **Step 2: Write the failing test**

Create `packages/db/test/backfill.test.ts`:

```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { FlowDefinition } from '@replyooo/shared'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../src'
import {
  automations,
  automationVersions,
  backfillRuns,
  claimBackfillRun,
  connectedAccounts,
  contacts,
  createBackfillRun,
  createDb,
  failStuckBackfillRuns,
  finishBackfillRun,
  flowRuns,
  handledCommentIds,
  latestBackfillRun,
  messages,
  queuedBackfillRunIds,
  workspaces,
} from '../src'

let container: StartedPostgreSqlContainer | undefined
let db: Db
let close: () => Promise<void>

beforeAll(async () => {
  let url = process.env.TEST_DATABASE_URL
  if (!url) {
    container = await new PostgreSqlContainer('postgres:18-alpine').start()
    url = container.getConnectionUri()
  }
  const created = createDb(url)
  db = created.db
  close = created.close
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) })
})

afterAll(async () => {
  await close?.()
  await container?.stop()
})

const flow: FlowDefinition = {
  trigger: { type: 'comment_keyword', posts: { mode: 'any' }, keywords: ['guide'], match: 'contains' },
  start: 's1',
  steps: { s1: { type: 'send_message', text: 'hi' } },
}

async function seed() {
  const tag = randomUUID().slice(0, 8)
  const [workspace] = await db.insert(workspaces).values({ name: 'Acme', ownerUserId: 'x' }).returning()
  const [account] = await db
    .insert(connectedAccounts)
    .values({ workspaceId: workspace!.id, platform: 'instagram', externalId: `ig_${tag}`, username: 'maya.makes', accessTokenEnc: 'x' })
    .returning()
  const [automation] = await db
    .insert(automations)
    .values({ workspaceId: workspace!.id, connectedAccountId: account!.id, name: 'Test', triggerType: 'comment_keyword', definition: flow })
    .returning()
  const [version] = await db
    .insert(automationVersions)
    .values({ automationId: automation!.id, version: 1, definition: flow, publishedAt: new Date() })
    .returning()
  const [contact] = await db
    .insert(contacts)
    .values({ workspaceId: workspace!.id, connectedAccountId: account!.id, platformUserId: `psid_${tag}` })
    .returning()
  return { workspace: workspace!, account: account!, automation: automation!, version: version!, contact: contact! }
}

describe('backfill runs', () => {
  it('creates a queued run, and a second request while it is active returns the same run', async () => {
    const s = await seed()
    const input = { automationId: s.automation.id, connectedAccountId: s.account.id, windowHours: 72 }
    const first = await createBackfillRun(db, input)
    expect(first.created).toBe(true)
    expect(first.run).toMatchObject({ status: 'queued', windowHours: 72, found: 0, capped: false })
    const second = await createBackfillRun(db, input)
    expect(second.created).toBe(false)
    expect(second.run.id).toBe(first.run.id)
  })

  it('allows a new run once the previous one has finished', async () => {
    const s = await seed()
    const input = { automationId: s.automation.id, connectedAccountId: s.account.id, windowHours: 24 }
    const first = await createBackfillRun(db, input)
    await claimBackfillRun(db, first.run.id, new Date())
    await finishBackfillRun(db, first.run.id, { status: 'failed', error: 'boom' }, new Date())
    const next = await createBackfillRun(db, input)
    expect(next.created).toBe(true)
    expect(next.run.id).not.toBe(first.run.id)
    expect((await latestBackfillRun(db, s.automation.id))?.id).toBe(next.run.id)
  })

  it('claims a queued run exactly once', async () => {
    const s = await seed()
    const { run } = await createBackfillRun(db, { automationId: s.automation.id, connectedAccountId: s.account.id, windowHours: 24 })
    const now = new Date('2026-10-13T10:00:00Z')
    const claimed = await claimBackfillRun(db, run.id, now)
    expect(claimed).toMatchObject({ status: 'running', startedAt: now })
    expect(await claimBackfillRun(db, run.id, now)).toBeNull()
  })

  it('records the outcome of a finished run', async () => {
    const s = await seed()
    const { run } = await createBackfillRun(db, { automationId: s.automation.id, connectedAccountId: s.account.id, windowHours: 168 })
    await claimBackfillRun(db, run.id, new Date())
    const done = new Date('2026-10-13T10:05:00Z')
    await finishBackfillRun(
      db,
      run.id,
      { status: 'done', found: 9, skippedHandled: 3, skippedNoMatch: 2, enqueued: 4, capped: true },
      done,
    )
    const [row] = await db.select().from(backfillRuns).where(eq(backfillRuns.id, run.id))
    expect(row).toMatchObject({ status: 'done', found: 9, skippedHandled: 3, skippedNoMatch: 2, enqueued: 4, capped: true, finishedAt: done })
  })

  it('lists queued runs oldest first, up to the limit', async () => {
    const a = await seed()
    const b = await seed()
    const first = await createBackfillRun(db, { automationId: a.automation.id, connectedAccountId: a.account.id, windowHours: 24 })
    const second = await createBackfillRun(db, { automationId: b.automation.id, connectedAccountId: b.account.id, windowHours: 24 })
    const ids = await queuedBackfillRunIds(db, 1000)
    expect(ids.indexOf(first.run.id)).toBeGreaterThanOrEqual(0)
    expect(ids.indexOf(first.run.id)).toBeLessThan(ids.indexOf(second.run.id))
    expect(await queuedBackfillRunIds(db, 1)).toHaveLength(1)
  })

  it('fails runs that have been running for over 30 minutes', async () => {
    const stale = await seed()
    const fresh = await seed()
    const now = new Date('2026-10-13T12:00:00Z')
    const staleRun = (await createBackfillRun(db, { automationId: stale.automation.id, connectedAccountId: stale.account.id, windowHours: 24 })).run
    const freshRun = (await createBackfillRun(db, { automationId: fresh.automation.id, connectedAccountId: fresh.account.id, windowHours: 24 })).run
    await claimBackfillRun(db, staleRun.id, new Date(now.getTime() - 31 * 60_000))
    await claimBackfillRun(db, freshRun.id, new Date(now.getTime() - 10 * 60_000))
    expect(await failStuckBackfillRuns(db, now)).toBeGreaterThanOrEqual(1)
    const [s] = await db.select().from(backfillRuns).where(eq(backfillRuns.id, staleRun.id))
    const [f] = await db.select().from(backfillRuns).where(eq(backfillRuns.id, freshRun.id))
    expect(s).toMatchObject({ status: 'failed', error: 'timed_out', finishedAt: now })
    expect(f?.status).toBe('running')
  })
})

describe('handledCommentIds', () => {
  it('counts comments with a flow run or an outbound message, but not an inbound-only comment', async () => {
    const s = await seed()
    const other = await seed()
    const ids = { run: `c_run_${randomUUID()}`, out: `c_out_${randomUUID()}`, inbound: `c_in_${randomUUID()}`, foreign: `c_other_${randomUUID()}`, fresh: `c_new_${randomUUID()}` }
    await db.insert(flowRuns).values({
      automationId: s.automation.id,
      automationVersionId: s.version.id,
      contactId: s.contact.id,
      connectedAccountId: s.account.id,
      commentId: ids.run,
    })
    await db.insert(messages).values([
      { contactId: s.contact.id, connectedAccountId: s.account.id, direction: 'out', kind: 'comment_reply', body: {}, status: 'sent', commentId: ids.out },
      { contactId: s.contact.id, connectedAccountId: s.account.id, direction: 'in', kind: 'comment', body: {}, status: 'received', commentId: ids.inbound },
    ])
    await db.insert(messages).values({
      contactId: other.contact.id,
      connectedAccountId: other.account.id,
      direction: 'out',
      kind: 'comment_reply',
      body: {},
      status: 'sent',
      commentId: ids.foreign,
    })
    const handled = await handledCommentIds(db, s.account.id, Object.values(ids))
    expect([...handled].sort()).toEqual([ids.out, ids.run].sort())
  })

  it('returns an empty set for no ids', async () => {
    const s = await seed()
    expect((await handledCommentIds(db, s.account.id, [])).size).toBe(0)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @replyooo/db exec vitest run test/backfill.test.ts`
Expected: FAIL (imports such as `createBackfillRun` / `backfillRuns` are not exported yet).

- [ ] **Step 4: Add the schema**

Append to `packages/db/src/schema.ts`:

```ts
// ---------- re-run on existing comments ----------

export const backfillStatusEnum = pgEnum('backfill_status', ['queued', 'running', 'done', 'failed'])

/**
 * One "run on existing comments" request. The web app inserts it as `queued`; the worker claims it, lists the
 * comments, and hands the eligible ones to the normal inbound job. The counts come from that last step.
 */
export const backfillRuns = pgTable(
  'backfill_runs',
  {
    id: id(),
    automationId: uuid('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    connectedAccountId: uuid('connected_account_id')
      .notNull()
      .references(() => connectedAccounts.id, { onDelete: 'cascade' }),
    windowHours: integer('window_hours').notNull(),
    status: backfillStatusEnum('status').notNull().default('queued'),
    found: integer('found').notNull().default(0),
    skippedHandled: integer('skipped_handled').notNull().default(0),
    skippedNoMatch: integer('skipped_no_match').notNull().default(0),
    enqueued: integer('enqueued').notNull().default(0),
    capped: boolean('capped').notNull().default(false),
    error: text('error'),
    createdAt: tz('created_at').notNull().defaultNow(),
    startedAt: tz('started_at'),
    finishedAt: tz('finished_at'),
  },
  (t) => [
    uniqueIndex('backfill_runs_one_active_per_automation')
      .on(t.automationId)
      .where(sql`${t.status} in ('queued', 'running')`),
    index('backfill_runs_automation_created_idx').on(t.automationId, t.createdAt),
  ],
)
```

- [ ] **Step 5: Add the helpers**

Create `packages/db/src/backfill.ts`:

```ts
import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm'
import type { Db } from './client'
import { backfillRuns, flowRuns, messages } from './schema'

/** Meta only allows a private reply within 7 days of the comment. */
export const BACKFILL_WINDOWS_HOURS = [24, 72, 168] as const
export const BACKFILL_MAX_COMMENTS = 500
const STUCK_AFTER_MS = 30 * 60_000

export type BackfillRun = typeof backfillRuns.$inferSelect

export interface BackfillOutcome {
  found: number
  skippedHandled: number
  skippedNoMatch: number
  enqueued: number
  capped: boolean
}

export type BackfillResult = ({ status: 'done' } & BackfillOutcome) | { status: 'failed'; error: string }

/** Starts a run, or returns the automation's active one (a double click must not error or double-send). */
export async function createBackfillRun(
  db: Db,
  input: { automationId: string; connectedAccountId: string; windowHours: number },
): Promise<{ run: BackfillRun; created: boolean }> {
  const [row] = await db.insert(backfillRuns).values(input).onConflictDoNothing().returning()
  if (row) return { run: row, created: true }
  const [active] = await db
    .select()
    .from(backfillRuns)
    .where(and(eq(backfillRuns.automationId, input.automationId), inArray(backfillRuns.status, ['queued', 'running'])))
  if (!active) throw new Error('Could not start the run')
  return { run: active, created: false }
}

export async function latestBackfillRun(db: Db, automationId: string): Promise<BackfillRun | null> {
  const [row] = await db
    .select()
    .from(backfillRuns)
    .where(eq(backfillRuns.automationId, automationId))
    .orderBy(desc(backfillRuns.createdAt), desc(backfillRuns.id))
    .limit(1)
  return row ?? null
}

export async function queuedBackfillRunIds(db: Db, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: backfillRuns.id })
    .from(backfillRuns)
    .where(eq(backfillRuns.status, 'queued'))
    .orderBy(asc(backfillRuns.createdAt), asc(backfillRuns.id))
    .limit(limit)
  return rows.map((row) => row.id)
}

/** Moves a queued run to running. Only one caller wins, so a job delivered twice does the work once. */
export async function claimBackfillRun(db: Db, id: string, now: Date): Promise<BackfillRun | null> {
  const [row] = await db
    .update(backfillRuns)
    .set({ status: 'running', startedAt: now })
    .where(and(eq(backfillRuns.id, id), eq(backfillRuns.status, 'queued')))
    .returning()
  return row ?? null
}

export async function finishBackfillRun(db: Db, id: string, result: BackfillResult, now: Date): Promise<void> {
  const values =
    result.status === 'done'
      ? {
          status: 'done' as const,
          found: result.found,
          skippedHandled: result.skippedHandled,
          skippedNoMatch: result.skippedNoMatch,
          enqueued: result.enqueued,
          capped: result.capped,
          error: null,
        }
      : { status: 'failed' as const, error: result.error }
  await db
    .update(backfillRuns)
    .set({ ...values, finishedAt: now })
    .where(eq(backfillRuns.id, id))
}

/** A worker that died mid-run would otherwise block the automation's next run forever. */
export async function failStuckBackfillRuns(db: Db, now: Date): Promise<number> {
  const rows = await db
    .update(backfillRuns)
    .set({ status: 'failed', error: 'timed_out', finishedAt: now })
    .where(and(eq(backfillRuns.status, 'running'), lt(backfillRuns.startedAt, new Date(now.getTime() - STUCK_AFTER_MS))))
    .returning({ id: backfillRuns.id })
  return rows.length
}

/**
 * Comment ids that already got an answer: a flow run was started for them, or we sent an outbound message about
 * them. An inbound `comment` message alone does not count; the webhook stores one even when no automation matched.
 */
export async function handledCommentIds(db: Db, accountId: string, commentIds: readonly string[]): Promise<Set<string>> {
  if (commentIds.length === 0) return new Set()
  const ids = [...commentIds]
  const runs = await db
    .select({ commentId: flowRuns.commentId })
    .from(flowRuns)
    .where(and(eq(flowRuns.connectedAccountId, accountId), inArray(flowRuns.commentId, ids)))
  const sent = await db
    .select({ commentId: messages.commentId })
    .from(messages)
    .where(and(eq(messages.connectedAccountId, accountId), eq(messages.direction, 'out'), inArray(messages.commentId, ids)))
  const handled = new Set<string>()
  for (const row of [...runs, ...sent]) if (row.commentId) handled.add(row.commentId)
  return handled
}
```

Edit `packages/db/src/index.ts` to add `export * from './backfill'` after the `./link-codes` line.

- [ ] **Step 6: Generate the migration**

Run: `pnpm --filter @replyooo/db exec drizzle-kit generate --name rerun_comments`
Expected: creates `packages/db/migrations/0010_rerun_comments.sql`, `meta/0010_snapshot.json`, and updates `meta/_journal.json`. Open the SQL: it must contain `CREATE TYPE "backfill_status"`, `CREATE TABLE "backfill_runs"` with FKs `ON DELETE cascade`, and `CREATE UNIQUE INDEX "backfill_runs_one_active_per_automation" ... WHERE "backfill_runs"."status" in ('queued', 'running')`. If drizzle-kit names the file differently (for example `0010_<adjective>_<name>.sql`), keep that name.

- [ ] **Step 7: Run the tests and typecheck**

Run: `pnpm --filter @replyooo/db exec vitest run test/backfill.test.ts && pnpm --filter @replyooo/db typecheck`
Expected: PASS (8 tests), typecheck clean.

- [ ] **Step 8: Run the whole db suite**

Run: `pnpm --filter @replyooo/db test`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add packages/db
git commit -m "feat(db): backfill_runs table and helpers for re-running on existing comments

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Meta adapters and the gather helper

**Files:**
- Modify: `packages/meta/src/types.ts`, `packages/meta/src/instagram.ts`, `packages/meta/src/facebook.ts`, `packages/meta/src/index.ts`
- Create: `packages/meta/src/comments.ts`
- Test: `packages/meta/test/instagram.test.ts`, `packages/meta/test/facebook.test.ts` (add cases), `packages/meta/test/comments.test.ts` (create)

**Interfaces:**
- Consumes: `graphRequest` (via each adapter's `call`), `Trigger` and `Platform` from `@replyooo/shared`.
- Produces (exported from `@replyooo/meta`):
  - `CommentItem { id; mediaId; text; createdAt: Date; authorId; authorUsername: string | null; authorName: string | null }`
  - `CommentPage { items: CommentItem[]; next?: string }`
  - `PlatformAdapter.listComments(account, mediaId, opts?: { cursor?: string; since?: Date }): Promise<CommentPage>`
  - `collectComments(adapter, account, mediaId, { since, max }): Promise<{ items: CommentItem[]; capped: boolean }>`
  - `commentTargets(trigger: Trigger, pinnedMediaId: string | null, media: { id: string }[]): string[]`
  - `gatherComments(adapter, account, input: { trigger; pinnedMediaId; since; max }): Promise<{ comments: CommentItem[]; capped: boolean }>`
  - `NormalizedEvent` `comment_created` gains optional `restrictToAutomationId?: string`

- [ ] **Step 1: Write the failing adapter tests**

Add to `packages/meta/test/instagram.test.ts` inside the `describe('createInstagramAdapter', ...)` block:

```ts
  it('lists a post’s comments with their authors and pages with a cursor', async () => {
    const calls = capture('get', `${base}/media_1/comments`, {
      data: [
        { id: 'c1', text: 'GUIDE please', timestamp: '2026-10-12T19:16:02+0000', from: { id: 'igsid_1', username: 'priya' } },
        { id: 'c2', text: 'hidden author', timestamp: '2026-10-12T19:10:00+0000' },
        { id: 'c3', text: 'no from, has username', timestamp: '2026-10-12T19:05:00+0000', username: 'sam' },
      ],
      paging: { cursors: { after: 'CUR2' }, next: 'https://graph.instagram.com/next' },
    })
    const page = await adapter.listComments(account, 'media_1', { cursor: 'CUR1' })
    expect(page.items).toEqual([
      {
        id: 'c1',
        mediaId: 'media_1',
        text: 'GUIDE please',
        createdAt: new Date('2026-10-12T19:16:02Z'),
        authorId: 'igsid_1',
        authorUsername: 'priya',
        authorName: null,
      },
    ])
    expect(page.next).toBe('CUR2')
    expect(calls[0]?.search.get('fields')).toBe('id,text,timestamp,username,from{id,username}')
    expect(calls[0]?.search.get('limit')).toBe('50')
    expect(calls[0]?.search.get('after')).toBe('CUR1')
  })

  it('has no next cursor on the last page', async () => {
    capture('get', `${base}/media_1/comments`, { data: [] })
    expect(await adapter.listComments(account, 'media_1')).toEqual({ items: [] })
  })
```

Add to `packages/meta/test/facebook.test.ts` (use the same `capture`, `base` and `adapter` names that file already defines; check its top lines and mirror them):

```ts
  it('lists a post’s comments, newest first, since a time', async () => {
    const calls = capture('get', `${base}/104_post1/comments`, {
      data: [
        { id: '104_c1', message: 'GUIDE', created_time: '2026-10-12T19:16:02+0000', from: { id: 'psid_1', name: 'Priya Sharma' } },
        { id: '104_c2', message: 'no author', created_time: '2026-10-12T19:10:00+0000' },
      ],
      paging: { cursors: { after: 'CUR2' }, next: 'https://graph.facebook.com/next' },
    })
    const since = new Date('2026-10-10T00:00:00Z')
    const page = await adapter.listComments(account, '104_post1', { since })
    expect(page.items).toEqual([
      {
        id: '104_c1',
        mediaId: '104_post1',
        text: 'GUIDE',
        createdAt: new Date('2026-10-12T19:16:02Z'),
        authorId: 'psid_1',
        authorUsername: null,
        authorName: 'Priya Sharma',
      },
    ])
    expect(page.next).toBe('CUR2')
    expect(calls[0]?.search.get('filter')).toBe('toplevel')
    expect(calls[0]?.search.get('order')).toBe('reverse_chronological')
    expect(calls[0]?.search.get('fields')).toBe('id,message,created_time,from{id,name}')
    expect(calls[0]?.search.get('since')).toBe(String(since.getTime() / 1000))
  })
```

- [ ] **Step 2: Write the failing helper tests**

Create `packages/meta/test/comments.test.ts`:

```ts
import type { Trigger } from '@replyooo/shared'
import { describe, expect, it } from 'vitest'
import type { CommentItem, CommentPage, PlatformAdapter } from '../src'
import { collectComments, commentTargets, gatherComments } from '../src'

const account = { externalId: 'acct', accessToken: 't' }
const NOW = new Date('2026-10-13T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

const item = (id: string, createdAt: Date, mediaId = 'm1'): CommentItem => ({
  id,
  mediaId,
  text: 'GUIDE',
  createdAt,
  authorId: `u_${id}`,
  authorUsername: null,
  authorName: null,
})

/** An adapter whose pages are given up front; the cursor is the page index. */
function pagedAdapter(pagesByMedia: Record<string, CommentItem[][]>) {
  const requests: { mediaId: string; cursor?: string; since?: Date }[] = []
  const adapter = {
    async listComments(_: unknown, mediaId: string, opts: { cursor?: string; since?: Date } = {}): Promise<CommentPage> {
      requests.push({ mediaId, ...opts })
      const pages = pagesByMedia[mediaId] ?? []
      const index = opts.cursor ? Number(opts.cursor) : 0
      const next = index + 1 < pages.length ? { next: String(index + 1) } : {}
      return { items: pages[index] ?? [], ...next }
    },
  } as unknown as Pick<PlatformAdapter, 'listComments'>
  return { adapter, requests }
}

describe('collectComments', () => {
  it('keeps comments inside the window and stops paging once a page is entirely older', async () => {
    const { adapter, requests } = pagedAdapter({
      m1: [
        [item('a', hoursAgo(1)), item('b', hoursAgo(30))],
        [item('c', hoursAgo(80)), item('d', hoursAgo(90))],
        [item('e', hoursAgo(100))],
      ],
    })
    const result = await collectComments(adapter, account, 'm1', { since: hoursAgo(48), max: 100 })
    expect(result).toEqual({ items: [item('a', hoursAgo(1)), item('b', hoursAgo(30))], capped: false })
    expect(requests).toHaveLength(2)
  })

  it('does not stop on an out-of-order page that still has in-window comments (ranked results)', async () => {
    const { adapter } = pagedAdapter({
      m1: [
        [item('old1', hoursAgo(100)), item('new1', hoursAgo(2))],
        [item('old2', hoursAgo(120)), item('new2', hoursAgo(3))],
      ],
    })
    const result = await collectComments(adapter, account, 'm1', { since: hoursAgo(48), max: 100 })
    expect(result.items.map((c) => c.id)).toEqual(['new1', 'new2'])
  })

  it('passes since to the adapter', async () => {
    const { adapter, requests } = pagedAdapter({ m1: [[item('a', hoursAgo(1))]] })
    const since = hoursAgo(24)
    await collectComments(adapter, account, 'm1', { since, max: 10 })
    expect(requests[0]?.since).toEqual(since)
  })

  it('stops at the cap and says so', async () => {
    const { adapter } = pagedAdapter({ m1: [[item('a', hoursAgo(1)), item('b', hoursAgo(2)), item('c', hoursAgo(3))]] })
    const result = await collectComments(adapter, account, 'm1', { since: hoursAgo(48), max: 2 })
    expect(result.items.map((c) => c.id)).toEqual(['a', 'b'])
    expect(result.capped).toBe(true)
  })

  it('is not capped when it ends exactly at the limit', async () => {
    const { adapter } = pagedAdapter({ m1: [[item('a', hoursAgo(1)), item('b', hoursAgo(2))]] })
    const result = await collectComments(adapter, account, 'm1', { since: hoursAgo(48), max: 2 })
    expect(result.capped).toBe(false)
  })

  it('keeps paging past a page whose comments were all dropped for having no author', async () => {
    const { adapter } = pagedAdapter({ m1: [[], [item('a', hoursAgo(1))]] })
    // The first page is empty after the adapter dropped authorless comments but still links to a next page.
    const paged = {
      async listComments(a: unknown, mediaId: string, opts: { cursor?: string; since?: Date } = {}) {
        const page = await adapter.listComments(a as never, mediaId, opts)
        return opts.cursor ? page : { ...page, next: '1' }
      },
    } as unknown as Pick<PlatformAdapter, 'listComments'>
    const result = await collectComments(paged, account, 'm1', { since: hoursAgo(48), max: 10 })
    expect(result.items.map((c) => c.id)).toEqual(['a'])
  })
})

describe('commentTargets', () => {
  const trigger = (posts: Extract<Trigger, { type: 'comment_keyword' }>['posts']): Trigger => ({
    type: 'comment_keyword',
    posts,
    keywords: [],
    match: 'contains',
  })

  it('uses the chosen posts', () => {
    expect(commentTargets(trigger({ mode: 'specific', mediaIds: ['a', 'b'] }), null, [{ id: 'z' }])).toEqual(['a', 'b'])
  })

  it('uses the pinned post for "next post", and nothing before it is pinned', () => {
    expect(commentTargets(trigger({ mode: 'next' }), 'p1', [])).toEqual(['p1'])
    expect(commentTargets(trigger({ mode: 'next' }), null, [])).toEqual([])
  })

  it('uses the recent posts for "any post"', () => {
    expect(commentTargets(trigger({ mode: 'any' }), null, [{ id: 'x' }, { id: 'y' }])).toEqual(['x', 'y'])
  })

  it('has no targets for other trigger types', () => {
    expect(commentTargets({ type: 'any_dm' }, null, [{ id: 'x' }])).toEqual([])
  })
})

describe('gatherComments', () => {
  const anyPost: Trigger = { type: 'comment_keyword', posts: { mode: 'any' }, keywords: [], match: 'contains' }

  it('reads each target post and shares one cap across them', async () => {
    const { adapter } = pagedAdapter({
      m1: [[item('a', hoursAgo(1), 'm1'), item('b', hoursAgo(2), 'm1')]],
      m2: [[item('c', hoursAgo(3), 'm2'), item('d', hoursAgo(4), 'm2')]],
    })
    const full = { ...adapter, listMedia: async () => [{ id: 'm1' }, { id: 'm2' }] } as unknown as PlatformAdapter
    const result = await gatherComments(full, account, { trigger: anyPost, pinnedMediaId: null, since: hoursAgo(48), max: 3 })
    expect(result.comments.map((c) => c.id)).toEqual(['a', 'b', 'c'])
    expect(result.capped).toBe(true)
  })

  it('does not list media when the automation names its posts', async () => {
    const { adapter } = pagedAdapter({ m9: [[item('a', hoursAgo(1), 'm9')]] })
    const full = {
      ...adapter,
      listMedia: async () => {
        throw new Error('should not list media')
      },
    } as unknown as PlatformAdapter
    const specific: Trigger = { type: 'comment_keyword', posts: { mode: 'specific', mediaIds: ['m9'] }, keywords: [], match: 'contains' }
    const result = await gatherComments(full, account, { trigger: specific, pinnedMediaId: null, since: hoursAgo(48), max: 10 })
    expect(result.comments.map((c) => c.id)).toEqual(['a'])
    expect(result.capped).toBe(false)
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @replyooo/meta exec vitest run test/comments.test.ts test/instagram.test.ts test/facebook.test.ts`
Expected: FAIL (`listComments` / `collectComments` do not exist).

- [ ] **Step 4: Add the types**

In `packages/meta/src/types.ts`, add after `MediaItem`:

```ts
/** A top-level comment on a post, as listed by the Graph API (the shape the webhook gives, plus the time). */
export interface CommentItem {
  id: string
  mediaId: string
  text: string
  createdAt: Date
  /** IGSID / PSID of the commenter. */
  authorId: string
  authorUsername: string | null
  authorName: string | null
}

export interface CommentPage {
  items: CommentItem[]
  /** Pass back as `cursor` to get the next page; absent on the last one. */
  next?: string
}
```

Add `restrictToAutomationId?: string` to the `comment_created` variant of `NormalizedEvent`:

```ts
  | (EventBase & {
      type: 'comment_created'
      commentId: string
      mediaId: string
      text: string
      senderUsername: string | null
      senderName: string | null
      /** Set on events a "run on existing comments" request creates: only this automation may answer them. */
      restrictToAutomationId?: string
    })
```

Add to `PlatformAdapter`, after `listMedia`:

```ts
  /** One page of a post's top-level comments. Authors we cannot identify are left out. */
  listComments(account: AccountCredentials, mediaId: string, opts?: { cursor?: string; since?: Date }): Promise<CommentPage>
```

- [ ] **Step 5: Implement Instagram and Facebook**

In `packages/meta/src/instagram.ts`, add after `listMedia`:

```ts
    async listComments(account, mediaId, opts = {}) {
      const res = await call<{
        data?: { id: string; text?: string; timestamp?: string; username?: string; from?: { id?: string; username?: string } }[]
        paging?: { cursors?: { after?: string }; next?: string }
      }>(account, `${mediaId}/comments`, {
        query: {
          fields: 'id,text,timestamp,username,from{id,username}',
          limit: '50',
          ...(opts.cursor ? { after: opts.cursor } : {}),
        },
      })
      const items = (res.data ?? []).flatMap((c) =>
        c.from?.id && c.timestamp
          ? [
              {
                id: c.id,
                mediaId,
                text: c.text ?? '',
                createdAt: new Date(c.timestamp),
                authorId: c.from.id,
                authorUsername: c.from.username ?? c.username ?? null,
                authorName: null,
              },
            ]
          : [],
      )
      const after = res.paging?.next ? res.paging.cursors?.after : undefined
      return { items, ...(after ? { next: after } : {}) }
    },
```

In `packages/meta/src/facebook.ts`, add after `listMedia`:

```ts
    async listComments(account, mediaId, opts = {}) {
      const res = await call<{
        data?: { id: string; message?: string; created_time?: string; from?: { id?: string; name?: string } }[]
        paging?: { cursors?: { after?: string }; next?: string }
      }>(account, `${mediaId}/comments`, {
        query: {
          fields: 'id,message,created_time,from{id,name}',
          filter: 'toplevel',
          order: 'reverse_chronological',
          limit: '50',
          ...(opts.since ? { since: String(Math.floor(opts.since.getTime() / 1000)) } : {}),
          ...(opts.cursor ? { after: opts.cursor } : {}),
        },
      })
      const items = (res.data ?? []).flatMap((c) =>
        c.from?.id && c.created_time
          ? [
              {
                id: c.id,
                mediaId,
                text: c.message ?? '',
                createdAt: new Date(c.created_time),
                authorId: c.from.id,
                authorUsername: null,
                authorName: c.from.name ?? null,
              },
            ]
          : [],
      )
      const after = res.paging?.next ? res.paging.cursors?.after : undefined
      return { items, ...(after ? { next: after } : {}) }
    },
```

- [ ] **Step 6: Implement the gather helper**

Create `packages/meta/src/comments.ts`:

```ts
import type { Trigger } from '@replyooo/shared'
import type { AccountCredentials, CommentItem, PlatformAdapter } from './types'

/** A safety net on paging; 20 pages of 50 is already twice the per-run comment cap. */
const MAX_PAGES = 20

/**
 * Reads a post's comments made at or after `since`, up to `max`. Instagram lists newest first and cannot filter
 * by time, so paging stops at the first non-empty page with nothing in the window. Facebook may rank the results,
 * so it is given `since` as well, and a page that still has in-window comments never ends the read.
 */
export async function collectComments(
  adapter: Pick<PlatformAdapter, 'listComments'>,
  account: AccountCredentials,
  mediaId: string,
  opts: { since: Date; max: number },
): Promise<{ items: CommentItem[]; capped: boolean }> {
  const items: CommentItem[] = []
  let cursor: string | undefined
  for (let pages = 0; pages < MAX_PAGES; pages++) {
    const page = await adapter.listComments(account, mediaId, { since: opts.since, ...(cursor ? { cursor } : {}) })
    const inWindow = page.items.filter((c) => c.createdAt.getTime() >= opts.since.getTime())
    for (const comment of inWindow) {
      if (items.length >= opts.max) return { items, capped: true }
      items.push(comment)
    }
    if (!page.next || (page.items.length > 0 && inWindow.length === 0)) break
    cursor = page.next
  }
  return { items, capped: false }
}

/** The posts whose comments a re-run should read, from the automation's trigger. */
export function commentTargets(trigger: Trigger, pinnedMediaId: string | null, recentMedia: { id: string }[]): string[] {
  if (trigger.type !== 'comment_keyword') return []
  switch (trigger.posts.mode) {
    case 'specific':
      return trigger.posts.mediaIds
    case 'next':
      return pinnedMediaId ? [pinnedMediaId] : []
    case 'any':
      return recentMedia.map((m) => m.id)
  }
}

/** Every in-window comment on the automation's posts, sharing one cap. Used by both the preview and the worker. */
export async function gatherComments(
  adapter: PlatformAdapter,
  account: AccountCredentials,
  input: { trigger: Trigger; pinnedMediaId: string | null; since: Date; max: number },
): Promise<{ comments: CommentItem[]; capped: boolean }> {
  const recent = input.trigger.type === 'comment_keyword' && input.trigger.posts.mode === 'any' ? await adapter.listMedia(account) : []
  const comments: CommentItem[] = []
  for (const mediaId of commentTargets(input.trigger, input.pinnedMediaId, recent)) {
    const remaining = input.max - comments.length
    if (remaining <= 0) return { comments, capped: true }
    const got = await collectComments(adapter, account, mediaId, { since: input.since, max: remaining })
    comments.push(...got.items)
    if (got.capped) return { comments, capped: true }
  }
  return { comments, capped: false }
}
```

Add `export * from './comments'` to `packages/meta/src/index.ts`.

- [ ] **Step 7: Run the tests and typecheck**

Run: `pnpm --filter @replyooo/meta test && pnpm --filter @replyooo/meta typecheck`
Expected: PASS. Typecheck of `meta` passes; other packages that implement `PlatformAdapter` (the worker's `FakeAdapter`) fail until Task 4, which is expected here, so do not run their typechecks yet.

- [ ] **Step 8: Commit**

```bash
git add packages/meta
git commit -m "feat(meta): list a post's comments and gather them for a re-run

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Classify comments (engine)

**Files:**
- Create: `packages/engine/src/backfill.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/backfill.test.ts`

**Interfaces:**
- Consumes: `matchAutomation`, `TriggerCandidate` from `./router`.
- Produces: `classifyComments<T extends BackfillComment>(comments: readonly T[], candidate: TriggerCandidate, handled: ReadonlySet<string>, now: Date): Record<BackfillBucket, T[]>`; types `BackfillComment { id; mediaId; text; createdAt: Date }`, `BackfillBucket = 'handled' | 'too_old' | 'no_match' | 'eligible'`; constant `PRIVATE_REPLY_MAX_AGE_MS`.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/backfill.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { TriggerCandidate } from '../src'
import { classifyComments } from '../src'

const NOW = new Date('2026-10-13T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)

const comment = (id: string, text: string, createdAt: Date, mediaId = 'm1') => ({ id, mediaId, text, createdAt })

const candidate = (overrides: Partial<Extract<TriggerCandidate['trigger'], { type: 'comment_keyword' }>> = {}): TriggerCandidate => ({
  automationId: 'a1',
  publishedAt: new Date('2026-10-01T00:00:00Z'),
  trigger: { type: 'comment_keyword', posts: { mode: 'any' }, keywords: ['guide'], match: 'contains', ...overrides },
  pinnedMediaId: null,
})

describe('classifyComments', () => {
  it('puts each comment in exactly one bucket', () => {
    const comments = [
      comment('ok', 'send me the GUIDE', daysAgo(1)),
      comment('done', 'guide please', daysAgo(1)),
      comment('nope', 'love this', daysAgo(1)),
      comment('old', 'guide', daysAgo(8)),
    ]
    const result = classifyComments(comments, candidate(), new Set(['done']), NOW)
    expect(result.eligible.map((c) => c.id)).toEqual(['ok'])
    expect(result.handled.map((c) => c.id)).toEqual(['done'])
    expect(result.no_match.map((c) => c.id)).toEqual(['nope'])
    expect(result.too_old.map((c) => c.id)).toEqual(['old'])
  })

  it('returns eligible comments oldest first', () => {
    const comments = [comment('new', 'guide', daysAgo(1)), comment('mid', 'guide', daysAgo(2)), comment('first', 'guide', daysAgo(3))]
    expect(classifyComments(comments, candidate(), new Set(), NOW).eligible.map((c) => c.id)).toEqual(['first', 'mid', 'new'])
  })

  it('treats every comment on the posts as a match when the automation has no keywords', () => {
    const result = classifyComments([comment('a', 'hello', daysAgo(1))], candidate({ keywords: [] }), new Set(), NOW)
    expect(result.eligible.map((c) => c.id)).toEqual(['a'])
  })

  it('only matches the chosen posts', () => {
    const c = candidate({ posts: { mode: 'specific', mediaIds: ['m1'] } })
    const result = classifyComments([comment('in', 'guide', daysAgo(1), 'm1'), comment('out', 'guide', daysAgo(1), 'm2')], c, new Set(), NOW)
    expect(result.eligible.map((x) => x.id)).toEqual(['in'])
    expect(result.no_match.map((x) => x.id)).toEqual(['out'])
  })

  it('counts a handled comment as handled even when it is also too old', () => {
    const result = classifyComments([comment('x', 'guide', daysAgo(9))], candidate(), new Set(['x']), NOW)
    expect(result.handled).toHaveLength(1)
    expect(result.too_old).toHaveLength(0)
  })

  it('treats a comment exactly 7 days old as still eligible', () => {
    const result = classifyComments([comment('edge', 'guide', daysAgo(7))], candidate(), new Set(), NOW)
    expect(result.eligible).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @replyooo/engine exec vitest run test/backfill.test.ts`
Expected: FAIL (`classifyComments` is not exported).

- [ ] **Step 3: Implement**

Create `packages/engine/src/backfill.ts`:

```ts
import type { TriggerCandidate } from './router'
import { matchAutomation } from './router'

/** Meta only allows a private reply within 7 days of the comment. */
export const PRIVATE_REPLY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface BackfillComment {
  id: string
  mediaId: string
  text: string
  createdAt: Date
}

export type BackfillBucket = 'handled' | 'too_old' | 'no_match' | 'eligible'

/**
 * Sorts comments for a re-run of one automation. Keyword and post rules come from `matchAutomation`, with the
 * automation as the only candidate, so a re-run can never be answered by a different automation.
 */
export function classifyComments<T extends BackfillComment>(
  comments: readonly T[],
  candidate: TriggerCandidate,
  handled: ReadonlySet<string>,
  now: Date,
): Record<BackfillBucket, T[]> {
  const result: Record<BackfillBucket, T[]> = { handled: [], too_old: [], no_match: [], eligible: [] }
  for (const comment of comments) {
    if (handled.has(comment.id)) {
      result.handled.push(comment)
    } else if (now.getTime() - comment.createdAt.getTime() > PRIVATE_REPLY_MAX_AGE_MS) {
      result.too_old.push(comment)
    } else if (
      !matchAutomation({ kind: 'comment', text: comment.text, mediaId: comment.mediaId, mediaPublishedAt: null }, [candidate])
    ) {
      result.no_match.push(comment)
    } else {
      result.eligible.push(comment)
    }
  }
  result.eligible.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  return result
}
```

Add to `packages/engine/src/index.ts`:

```ts
export { classifyComments, PRIVATE_REPLY_MAX_AGE_MS } from './backfill'
export type { BackfillBucket, BackfillComment } from './backfill'
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @replyooo/engine test && pnpm --filter @replyooo/engine typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat(engine): classify comments for a re-run of one automation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Worker (restriction, backfill job, sweep, queue)

**Files:**
- Modify: `apps/worker/src/inbound.ts`, `apps/worker/src/deps.ts`, `apps/worker/src/maintenance.ts`, `apps/worker/src/queues.ts`
- Create: `apps/worker/src/backfill.ts`
- Modify: `apps/worker/test/support.ts` (FakeAdapter and RecordingJobs)
- Test: `apps/worker/test/backfill.test.ts` (create), `apps/worker/test/inbound.test.ts` and `apps/worker/test/maintenance.test.ts` (add cases)

**Interfaces:**
- Consumes: from `@replyooo/db`: `claimBackfillRun`, `finishBackfillRun`, `handledCommentIds`, `queuedBackfillRunIds`, `failStuckBackfillRuns`, `BACKFILL_MAX_COMMENTS`, `webhookEvents`, `automations`, `automationVersions`, `connectedAccounts`; from `@replyooo/meta`: `gatherComments`, `MetaError`, `NormalizedEvent`; from `@replyooo/engine`: `classifyComments`, `TriggerCandidate`.
- Produces:
  - `handleBackfill(deps: Deps, runId: string, opts?: { maxComments?: number }): Promise<void>`
  - `Jobs.backfill(runId: string): Promise<void>`
  - queue name `'backfill'`; `sweep` queues `queued` runs and fails stuck ones.

- [ ] **Step 1: Extend the test doubles**

In `apps/worker/test/support.ts`:

1. Import `CommentItem`, `CommentPage`, `MediaItem` from `@replyooo/meta` (add to the existing `import type { ... } from '@replyooo/meta'` list).
2. In `RecordingJobs`, add `backfills: string[] = []`, an `async backfill(runId: string) { this.backfills.push(runId) }` method, and `this.backfills = []` inside `clear()`.
3. In `FakeAdapter`, add fields and replace `listMedia`:

```ts
  /** Comments by post id, served newest first in one page. */
  comments: Record<string, CommentItem[]> = {}
  media: MediaItem[] = []
```

```ts
  async listMedia() {
    return this.media
  }
  async listComments(_: AccountCredentials, mediaId: string, opts: { since?: Date } = {}): Promise<CommentPage> {
    this.calls.push({ method: 'listComments', args: [mediaId, opts.since] })
    const error = this.errors.shift()
    if (error) throw error
    return { items: [...(this.comments[mediaId] ?? [])].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) }
  }
```

Add a small builder near the other event builders:

```ts
export const listedComment = (
  id: string,
  authorId: string,
  text: string,
  createdAt: Date,
  mediaId = 'media1',
): CommentItem => ({ id, mediaId, text, createdAt, authorId, authorUsername: 'priya', authorName: null })
```

- [ ] **Step 2: Write the failing restriction test**

Add to `apps/worker/test/inbound.test.ts` inside `describe('handleInbound', ...)` (it reuses `commentFlow`, `setup`, `publishAutomation`, `insertEvent`, `comment`, `NOW`):

```ts
  it('lets only the restricted automation answer a re-run comment', async () => {
    const { db, deps, jobs, account } = await setup()
    const older = await publishAutomation(db, account, commentFlow(), { publishedAt: new Date(NOW.getTime() - 2 * 86_400_000) })
    await publishAutomation(db, account, commentFlow(), { publishedAt: NOW })
    const event = { ...comment(account, 'u1', 'send the guide'), restrictToAutomationId: older.automation.id }
    await handleInbound(deps, await insertEvent(db, event))
    expect(jobs.flows).toHaveLength(1)
    const [run] = await db.select().from(flowRuns).where(eq(flowRuns.contactId, (await db.select().from(contacts))[0]!.id))
    expect(run?.automationId).toBe(older.automation.id)
  })

  it('ignores a restricted re-run comment when its automation is no longer active', async () => {
    const { db, deps, jobs, account } = await setup()
    const only = await publishAutomation(db, account, commentFlow())
    await publishAutomation(db, account, commentFlow(), { publishedAt: new Date(NOW.getTime() + 1000) })
    await db.update(automations).set({ status: 'paused' }).where(eq(automations.id, only.automation.id))
    const event = { ...comment(account, 'u1', 'guide'), restrictToAutomationId: only.automation.id }
    await handleInbound(deps, await insertEvent(db, event))
    expect(jobs.flows).toEqual([])
  })
```

(The `comment(...)` builder returns `NormalizedEvent`; spreading it and adding `restrictToAutomationId` type-checks only for the `comment_created` variant, so cast: `as NormalizedEvent`. Add `import type { NormalizedEvent } from '@replyooo/meta'` at the top of the test file and write `{ ...comment(...), restrictToAutomationId: id } as NormalizedEvent`.)

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @replyooo/worker exec vitest run test/inbound.test.ts -t "re-run"`
Expected: FAIL (the newest automation answers; the restriction does not exist yet).

- [ ] **Step 4: Implement the restriction**

In `apps/worker/src/inbound.ts`, replace

```ts
  const candidates = await loadCandidates(db, account.id)
```

with

```ts
  const allCandidates = await loadCandidates(db, account.id)
  // A re-run comment may only be answered by the automation that asked for it.
  const candidates =
    event.type === 'comment_created' && event.restrictToAutomationId
      ? allCandidates.filter((c) => c.automationId === event.restrictToAutomationId)
      : allCandidates
```

- [ ] **Step 5: Run the inbound tests**

Run: `pnpm --filter @replyooo/worker exec vitest run test/inbound.test.ts`
Expected: PASS (all, including the two new ones).

- [ ] **Step 6: Write the failing backfill tests**

Create `apps/worker/test/backfill.test.ts`:

```ts
import {
  automations,
  backfillRuns,
  connectedAccounts,
  createBackfillRun,
  flowRuns,
  messages,
  webhookEvents,
} from '@replyooo/db'
import { MetaError, type NormalizedEvent } from '@replyooo/meta'
import type { FlowDefinition } from '@replyooo/shared'
import { eq, like } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { handleBackfill } from '../src/backfill'
import { handleInbound } from '../src/inbound'
import {
  createTestContext,
  insertRun,
  listedComment,
  NOW,
  publishAutomation,
  seedAccount,
  seedContact,
} from './support'

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

const commentFlow = (posts: { mode: 'any' } | { mode: 'specific'; mediaIds: string[] } = { mode: 'specific', mediaIds: ['media1'] }): FlowDefinition => ({
  trigger: { type: 'comment_keyword', posts, keywords: ['guide'], match: 'contains' },
  start: 's1',
  steps: { s1: { type: 'send_message', text: 'Here you go' } },
})

async function setup(opts: { flow?: FlowDefinition; windowHours?: number } = {}) {
  const ctx = createTestContext()
  const db = ctx.deps.db
  const { account } = await seedAccount(db)
  const published = await publishAutomation(db, account, opts.flow ?? commentFlow(), { publishedAt: hoursAgo(100) })
  const { run } = await createBackfillRun(db, {
    automationId: published.automation.id,
    connectedAccountId: account.id,
    windowHours: opts.windowHours ?? 72,
  })
  const events = async () =>
    (await db.select().from(webhookEvents).where(like(webhookEvents.dedupKey, `backfill:${run.id}:%`))).map(
      (row) => row.payload as Extract<NormalizedEvent, { type: 'comment_created' }>,
    )
  const reload = async () => (await db.select().from(backfillRuns).where(eq(backfillRuns.id, run.id)))[0]!
  return { ...ctx, db, account, ...published, run, events, reload }
}

describe('handleBackfill', () => {
  it('turns eligible comments into restricted events, oldest first, and hands them to the inbound job', async () => {
    const { deps, adapters, db, account, automation, run, events, reload, jobs } = await setup()
    adapters.instagram.comments.media1 = [
      listedComment('c_new', 'u3', 'guide pls', hoursAgo(2)),
      listedComment('c_mid', 'u2', 'the GUIDE', hoursAgo(10)),
      listedComment('c_old', 'u1', 'guide', hoursAgo(30)),
    ]
    await handleBackfill(deps, run.id)

    const stored = await events()
    expect(stored.map((e) => e.commentId).sort()).toEqual(['c_mid', 'c_new', 'c_old'])
    for (const event of stored) {
      expect(event).toMatchObject({
        type: 'comment_created',
        accountExternalId: account.externalId,
        restrictToAutomationId: automation.id,
      })
    }
    const byId = Object.fromEntries(stored.map((e) => [e.commentId, e]))
    expect(byId.c_old?.occurredAt).toBe(hoursAgo(30).toISOString())
    expect(jobs.inbounds).toHaveLength(3)
    // Enqueued oldest first.
    const order = await Promise.all(
      jobs.inbounds.map(async (id) => ((await db.select().from(webhookEvents).where(eq(webhookEvents.id, id)))[0]!.payload as { commentId: string }).commentId),
    )
    expect(order).toEqual(['c_old', 'c_mid', 'c_new'])
    expect(await reload()).toMatchObject({ status: 'done', found: 3, enqueued: 3, skippedHandled: 0, skippedNoMatch: 0, capped: false })
  })

  it('skips comments outside the window, the account’s own, and ones that do not match', async () => {
    const { deps, adapters, account, run, events, reload } = await setup({ windowHours: 24 })
    adapters.instagram.comments.media1 = [
      listedComment('c_ok', 'u1', 'guide', hoursAgo(2)),
      listedComment('c_old', 'u2', 'guide', hoursAgo(30)),
      listedComment('c_own', account.externalId, 'guide', hoursAgo(3)),
      listedComment('c_other', 'u3', 'nice photo', hoursAgo(4)),
    ]
    await handleBackfill(deps, run.id)
    expect((await events()).map((e) => e.commentId)).toEqual(['c_ok'])
    expect(await reload()).toMatchObject({ found: 2, enqueued: 1, skippedNoMatch: 1, skippedHandled: 0 })
  })

  it('skips comments that already have a run or an outbound reply', async () => {
    const { deps, adapters, db, account, automation, version, run, events, reload } = await setup()
    const contact = await seedContact(db, account)
    await insertRun(db, { account, contact, automation, version }, { commentId: 'c_run' })
    await db.insert(messages).values({
      contactId: contact.id,
      connectedAccountId: account.id,
      direction: 'out',
      kind: 'comment_reply',
      body: {},
      status: 'sent',
      commentId: 'c_reply',
    })
    adapters.instagram.comments.media1 = [
      listedComment('c_run', 'u1', 'guide', hoursAgo(2)),
      listedComment('c_reply', 'u2', 'guide', hoursAgo(3)),
      listedComment('c_fresh', 'u3', 'guide', hoursAgo(4)),
    ]
    await handleBackfill(deps, run.id)
    expect((await events()).map((e) => e.commentId)).toEqual(['c_fresh'])
    expect(await reload()).toMatchObject({ found: 3, skippedHandled: 2, enqueued: 1 })
  })

  it('still answers a comment the webhook stored but no automation matched (inbound row only)', async () => {
    const { deps, adapters, db, account, run, events } = await setup()
    const contact = await seedContact(db, account)
    await db.insert(messages).values({
      contactId: contact.id,
      connectedAccountId: account.id,
      direction: 'in',
      kind: 'comment',
      body: { text: 'guide', mediaId: 'media1' },
      status: 'received',
      commentId: 'c_seen',
    })
    adapters.instagram.comments.media1 = [listedComment('c_seen', 'u1', 'guide', hoursAgo(2))]
    await handleBackfill(deps, run.id)
    expect((await events()).map((e) => e.commentId)).toEqual(['c_seen'])
  })

  it('stops at the comment cap and records it', async () => {
    const { deps, adapters, run, events, reload } = await setup()
    adapters.instagram.comments.media1 = [
      listedComment('c1', 'u1', 'guide', hoursAgo(1)),
      listedComment('c2', 'u2', 'guide', hoursAgo(2)),
      listedComment('c3', 'u3', 'guide', hoursAgo(3)),
    ]
    await handleBackfill(deps, run.id, { maxComments: 2 })
    expect((await events()).map((e) => e.commentId).sort()).toEqual(['c1', 'c2'])
    expect(await reload()).toMatchObject({ status: 'done', capped: true, enqueued: 2 })
  })

  it('reads the recent posts for an any-post automation', async () => {
    const { deps, adapters, run, events } = await setup({ flow: commentFlow({ mode: 'any' }) })
    adapters.instagram.media = [
      { id: 'mediaA', caption: null, thumbnailUrl: null, permalink: null, publishedAt: hoursAgo(500) },
      { id: 'mediaB', caption: null, thumbnailUrl: null, permalink: null, publishedAt: hoursAgo(5) },
    ]
    adapters.instagram.comments.mediaA = [listedComment('cA', 'u1', 'guide', hoursAgo(2), 'mediaA')]
    adapters.instagram.comments.mediaB = [listedComment('cB', 'u2', 'guide', hoursAgo(3), 'mediaB')]
    await handleBackfill(deps, run.id)
    expect((await events()).map((e) => e.commentId).sort()).toEqual(['cA', 'cB'])
  })

  it('does nothing when the run was already claimed (job delivered twice)', async () => {
    const { deps, adapters, run, events } = await setup()
    adapters.instagram.comments.media1 = [listedComment('c1', 'u1', 'guide', hoursAgo(1))]
    await handleBackfill(deps, run.id)
    await handleBackfill(deps, run.id)
    expect(await events()).toHaveLength(1)
    expect(adapters.instagram.sent('listComments')).toHaveLength(1)
  })

  it('fails the run when the account needs reauth, or the automation is not active', async () => {
    const inactive = await setup()
    await inactive.db.update(connectedAccounts).set({ status: 'reauth_required' }).where(eq(connectedAccounts.id, inactive.account.id))
    await handleBackfill(inactive.deps, inactive.run.id)
    expect(await inactive.reload()).toMatchObject({ status: 'failed', error: 'account_inactive' })

    const paused = await setup()
    await paused.db.update(automations).set({ status: 'paused' }).where(eq(automations.id, paused.automation.id))
    await handleBackfill(paused.deps, paused.run.id)
    expect(await paused.reload()).toMatchObject({ status: 'failed', error: 'automation_not_active' })
  })

  it('fails the run and flags the account when Meta revokes access mid-run', async () => {
    const { deps, adapters, db, account, run, reload } = await setup()
    adapters.instagram.errors.push(new MetaError('reauth', 'expired', { reason: 'token_invalid' }))
    await handleBackfill(deps, run.id)
    expect(await reload()).toMatchObject({ status: 'failed', error: 'token_invalid' })
    const [after] = await db.select().from(connectedAccounts).where(eq(connectedAccounts.id, account.id))
    expect(after?.status).toBe('reauth_required')
  })

  it('fails with the reason when Meta is temporarily unavailable', async () => {
    const { deps, adapters, run, reload } = await setup()
    adapters.instagram.errors.push(new MetaError('retryable', 'try later', { reason: 'network' }))
    await handleBackfill(deps, run.id)
    expect(await reload()).toMatchObject({ status: 'failed', error: 'network' })
  })

  it('end to end: the same person commenting twice gets one flow, and an earlier answer is not repeated', async () => {
    const { deps, adapters, db, run, jobs } = await setup()
    adapters.instagram.comments.media1 = [
      listedComment('c_a1', 'u1', 'guide', hoursAgo(5)),
      listedComment('c_a2', 'u1', 'guide again', hoursAgo(1)),
      listedComment('c_b', 'u2', 'guide', hoursAgo(2)),
    ]
    await handleBackfill(deps, run.id)
    for (const id of [...jobs.inbounds]) await handleInbound(deps, id)
    const runs = await db.select().from(flowRuns).where(eq(flowRuns.automationId, run.automationId))
    expect(runs.map((r) => r.commentId).sort()).toEqual(['c_a1', 'c_b'])
    expect(jobs.flows).toHaveLength(2)
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm --filter @replyooo/worker exec vitest run test/backfill.test.ts`
Expected: FAIL (`../src/backfill` does not exist).

- [ ] **Step 8: Implement `handleBackfill`**

Create `apps/worker/src/backfill.ts`:

```ts
import {
  automations,
  automationVersions,
  BACKFILL_MAX_COMMENTS,
  claimBackfillRun,
  connectedAccounts,
  finishBackfillRun,
  handledCommentIds,
  webhookEvents,
} from '@replyooo/db'
import type { TriggerCandidate } from '@replyooo/engine'
import { classifyComments } from '@replyooo/engine'
import type { NormalizedEvent } from '@replyooo/meta'
import { gatherComments, MetaError } from '@replyooo/meta'
import { eq } from 'drizzle-orm'
import { flagReauth } from './alerts'
import type { Deps } from './deps'
import { credentials } from './records'

class BackfillFailure extends Error {}

/**
 * Runs one "run on existing comments" request. Comments are not answered here: each eligible one becomes a
 * `comment_created` event (limited to this automation) and goes through the normal inbound job, so matching,
 * plan limits, the re-entry cooldown, the flow and sending are the code live comments already use.
 * Failures end the run with a reason rather than retrying; the user can run it again.
 */
export async function handleBackfill(deps: Deps, runId: string, opts: { maxComments?: number } = {}): Promise<void> {
  const { db } = deps
  const run = await claimBackfillRun(db, runId, deps.now())
  if (!run) return
  try {
    const outcome = await execute(deps, run, opts.maxComments ?? BACKFILL_MAX_COMMENTS)
    await finishBackfillRun(db, run.id, { status: 'done', ...outcome }, deps.now())
  } catch (error) {
    let reason = 'unexpected_error'
    if (error instanceof BackfillFailure) {
      reason = error.message
    } else if (error instanceof MetaError) {
      reason = error.details.reason ?? error.kind
      if (error.kind === 'reauth') await flagReauth(deps, run.connectedAccountId)
    } else {
      deps.log.error({ err: error, runId }, 'backfill failed')
    }
    await finishBackfillRun(db, run.id, { status: 'failed', error: reason }, deps.now())
  }
}

async function execute(deps: Deps, run: { id: string; automationId: string; windowHours: number }, max: number) {
  const { db } = deps
  const now = deps.now()
  const [row] = await db
    .select({
      automation: automations,
      account: connectedAccounts,
      definition: automationVersions.definition,
      publishedAt: automationVersions.publishedAt,
      versionId: automationVersions.id,
    })
    .from(automations)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, automations.connectedAccountId))
    .innerJoin(automationVersions, eq(automationVersions.id, automations.currentVersionId))
    .where(eq(automations.id, run.automationId))
  if (!row || row.automation.status !== 'active') throw new BackfillFailure('automation_not_active')
  if (row.account.status !== 'active') throw new BackfillFailure('account_inactive')
  const trigger = row.definition.trigger
  if (trigger.type !== 'comment_keyword') throw new BackfillFailure('not_a_comment_automation')

  const { account } = row
  const adapter = deps.adapters[account.platform]
  const since = new Date(now.getTime() - run.windowHours * 3_600_000)
  const gathered = await gatherComments(adapter, credentials(account, deps.tokenKey), {
    trigger,
    pinnedMediaId: row.automation.pinnedMediaId,
    since,
    max,
  })
  const others = gathered.comments.filter((comment) => comment.authorId !== account.externalId)
  const handled = await handledCommentIds(db, account.id, others.map((c) => c.id))
  const candidate: TriggerCandidate = {
    automationId: row.automation.id,
    publishedAt: row.publishedAt,
    trigger,
    pinnedMediaId: row.automation.pinnedMediaId,
  }
  const buckets = classifyComments(others, candidate, handled, now)

  let enqueued = 0
  for (const comment of buckets.eligible) {
    const event: NormalizedEvent = {
      type: 'comment_created',
      platform: account.platform,
      accountExternalId: account.externalId,
      dedupKey: `backfill:${run.id}:${comment.id}`,
      occurredAt: comment.createdAt.toISOString(),
      senderId: comment.authorId,
      commentId: comment.id,
      mediaId: comment.mediaId,
      text: comment.text,
      senderUsername: comment.authorUsername,
      senderName: comment.authorName,
      restrictToAutomationId: row.automation.id,
    }
    const [stored] = await db
      .insert(webhookEvents)
      .values({ platform: account.platform, dedupKey: event.dedupKey, payload: event })
      .onConflictDoNothing({ target: webhookEvents.dedupKey })
      .returning({ id: webhookEvents.id })
    if (!stored) continue
    await deps.jobs.inbound(stored.id)
    enqueued++
  }
  return {
    found: others.length,
    skippedHandled: buckets.handled.length,
    skippedNoMatch: buckets.no_match.length + buckets.too_old.length,
    enqueued,
    capped: gathered.capped,
  }
}
```

- [ ] **Step 9: Run the backfill tests**

Run: `pnpm --filter @replyooo/worker exec vitest run test/backfill.test.ts`
Expected: the cases pass except possibly `flagReauth` details. If `flagReauth` needs a member to mail (see `outbound.test.ts` reauth case which calls `seedMember` first), the account status still flips to `reauth_required`; if the test errors inside `flagReauth`, read `apps/worker/src/alerts.ts` and seed a workspace member in that test the same way `outbound.test.ts` does (`seedMember(db, account.workspaceId, 'owner')`). Fix the test, not the production code, unless `flagReauth` throws for a workspace with no members (then guard in `alerts.ts` is out of scope; seed the member).

- [ ] **Step 10: Write the failing sweep and queue tests**

Add to `apps/worker/test/maintenance.test.ts` (imports `backfillRuns`, `claimBackfillRun`, `createBackfillRun` from `@replyooo/db`; it already imports `sweep`, `createTestContext`, `NOW`, `publishAutomation`, `seedAccount`):

```ts
describe('sweep: re-run on existing comments', () => {
  const commentFlow: FlowDefinition = {
    trigger: { type: 'comment_keyword', posts: { mode: 'any' }, keywords: [], match: 'contains' },
    start: 's1',
    steps: { s1: { type: 'send_message', text: 'hi' } },
  }

  it('queues waiting runs and fails runs stuck running', async () => {
    const { deps, jobs } = createTestContext()
    const { account } = await seedAccount(deps.db)
    const queued = await publishAutomation(deps.db, account, commentFlow)
    const { run: waiting } = await createBackfillRun(deps.db, { automationId: queued.automation.id, connectedAccountId: account.id, windowHours: 24 })

    const { account: other } = await seedAccount(deps.db)
    const stuckAutomation = await publishAutomation(deps.db, other, commentFlow)
    const { run: stuck } = await createBackfillRun(deps.db, { automationId: stuckAutomation.automation.id, connectedAccountId: other.id, windowHours: 24 })
    await claimBackfillRun(deps.db, stuck.id, new Date(NOW.getTime() - 40 * 60_000))

    await sweep(deps)

    expect(jobs.backfills).toContain(waiting.id)
    expect(jobs.backfills).not.toContain(stuck.id)
    const [row] = await deps.db.select().from(backfillRuns).where(eq(backfillRuns.id, stuck.id))
    expect(row).toMatchObject({ status: 'failed', error: 'timed_out' })
  })
})
```

- [ ] **Step 11: Run it to verify it fails**

Run: `pnpm --filter @replyooo/worker exec vitest run test/maintenance.test.ts -t "re-run"`
Expected: FAIL (`jobs.backfill` is not part of `Jobs`; sweep does not queue runs).

- [ ] **Step 12: Wire the job, sweep and queue**

In `apps/worker/src/deps.ts`, add to `Jobs`:

```ts
  backfill(runId: string): Promise<void>
```

In `apps/worker/src/maintenance.ts`, add `failStuckBackfillRuns` and `queuedBackfillRunIds` to the `@replyooo/db` import, and at the end of `sweep` (after the last existing block, before the function's closing brace and before any `return`), add:

```ts
  await failStuckBackfillRuns(db, deps.now())
  for (const runId of await queuedBackfillRunIds(db, SWEEP_BATCH)) await jobs.backfill(runId)
```

In `apps/worker/src/queues.ts`:
- `export type QueueName = 'inbound' | 'flow' | 'outbound' | 'maintenance' | 'backfill'`
- in `createQueues` add `backfill: new Queue('backfill', { ...options, defaultJobOptions: { ...defaultJobOptions, attempts: 1 } }),`
- in `createBullJobs` add:

```ts
    async backfill(runId) {
      await queues.backfill.add('backfill', { runId }, { jobId: `backfill-${runId}` })
    },
```

- in `startWorkers`, import `handleBackfill` from `./backfill` and add this worker to the `workers` array:

```ts
    new Worker('backfill', async (job: Job<{ runId: string }>) => handleBackfill(deps, job.data.runId), { ...base, concurrency: 1 }),
```

- [ ] **Step 13: Run the whole worker suite and typecheck**

Run: `pnpm --filter @replyooo/worker test && pnpm --filter @replyooo/worker typecheck`
Expected: PASS. If typecheck reports another `Jobs` or `PlatformAdapter` implementer (search with `grep -rn "implements Jobs\|implements PlatformAdapter\|: Jobs = " apps packages --include=*.ts`), add the missing method there, mirroring the test double.

- [ ] **Step 14: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): run automations on existing comments through the inbound pipeline

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Web data layer and actions

**Files:**
- Create: `apps/web/src/lib/rerun.ts`, `apps/web/src/lib/data/backfill.ts`
- Modify: `apps/web/src/lib/data/index.ts`, `apps/web/src/app/actions.ts`
- Test: `apps/web/test/rerun.test.ts`

**Interfaces:**
- Consumes: `gatherComments`, `MetaError` from `@replyooo/meta`; `classifyComments` from `@replyooo/engine`; `createBackfillRun`, `latestBackfillRun`, `handledCommentIds`, `BACKFILL_WINDOWS_HOURS`, `BACKFILL_MAX_COMMENTS` from `@replyooo/db`; `adapterFor`, `credentialsFor` from `@/lib/meta`; `isUuid`.
- Produces (from `@/lib/data`):
  - `type RerunErrorCode = 'not_found' | 'bad_window' | 'not_comment_automation' | 'not_active' | 'no_post_yet' | 'account_inactive' | 'reauth' | 'meta'`
  - `interface RerunPreview { found: number; handled: number; noMatch: number; eligible: number; capped: boolean }`
  - `interface RerunRun { id; status: 'queued' | 'running' | 'done' | 'failed'; windowHours: number; found: number; skippedHandled: number; skippedNoMatch: number; enqueued: number; capped: boolean; error: string | null; createdAt: string; finishedAt: string | null }`
  - `type RerunResult<T> = { ok: true } & T | { ok: false; code: RerunErrorCode; message: string }`
  - `previewRerun(workspaceId, automationId, windowHours): Promise<RerunResult<{ preview: RerunPreview }>>`
  - `startRerun(workspaceId, automationId, windowHours): Promise<RerunResult<{ run: RerunRun }>>`
  - `latestRerun(workspaceId, automationId): Promise<RerunRun | null>`
  - `RERUN_WINDOWS` from `@/lib/rerun` (client-safe)
- Actions in `actions.ts`: `previewRerun(automationId, windowHours)`, `startRerun(automationId, windowHours)`, `getLatestRerun(automationId)`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/rerun.test.ts`:

```ts
import { automations, automationVersions, BACKFILL_WINDOWS_HOURS, backfillRuns, connectedAccounts, flowRuns } from '@replyooo/db'
import type { FlowDefinition } from '@replyooo/shared'
import { eq } from 'drizzle-orm'
import { http, HttpResponse } from 'msw'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import * as data from '@/lib/data'
import { db } from '@/lib/db'
import { RERUN_WINDOWS } from '@/lib/rerun'
import { createAccount, createContact, createWorkspace, mockFetch, one } from './support'

const server = mockFetch()
beforeEach(() => server.reset())
afterAll(() => server.restore())

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString().replace('Z', '+0000')

const flow = (posts: { mode: 'any' } | { mode: 'next' } | { mode: 'specific'; mediaIds: string[] }): FlowDefinition => ({
  trigger: { type: 'comment_keyword', posts, keywords: ['guide'], match: 'contains' },
  start: 's1',
  steps: { s1: { type: 'send_message', text: 'Here you go' } },
})

async function setup(opts: { posts?: Parameters<typeof flow>[0]; status?: 'active' | 'paused'; pinned?: string | null } = {}) {
  const { workspaceId } = await createWorkspace()
  const account = await createAccount(workspaceId)
  const definition = flow(opts.posts ?? { mode: 'specific', mediaIds: ['m1'] })
  const automation = one(
    await db()
      .insert(automations)
      .values({
        workspaceId,
        connectedAccountId: account.id,
        name: 'Guide',
        status: opts.status ?? 'active',
        triggerType: 'comment_keyword',
        definition,
        pinnedMediaId: opts.pinned ?? null,
      })
      .returning(),
  )
  const version = one(
    await db().insert(automationVersions).values({ automationId: automation.id, version: 1, definition, publishedAt: new Date() }).returning(),
  )
  await db().update(automations).set({ currentVersionId: version.id }).where(eq(automations.id, automation.id))
  return { workspaceId, account, automation, version }
}

function comments(mediaId: string, items: { id: string; text: string; hoursAgo: number; from?: string | null }[]) {
  server.use(
    http.get(`https://graph.instagram.com/v24.0/${mediaId}/comments`, () =>
      HttpResponse.json({
        data: items.map((c) => ({
          id: c.id,
          text: c.text,
          timestamp: hoursAgo(c.hoursAgo),
          ...(c.from === null ? {} : { from: { id: c.from ?? `u_${c.id}`, username: 'someone' } }),
        })),
      }),
    ),
  )
}

describe('rerun windows', () => {
  it('match what the database accepts', () => {
    expect([...RERUN_WINDOWS]).toEqual([...BACKFILL_WINDOWS_HOURS])
  })
})

describe('previewRerun', () => {
  it('counts comments found, handled, not matching and eligible', async () => {
    const s = await setup()
    const contact = await createContact(s.workspaceId, s.account.id)
    await db().insert(flowRuns).values({
      automationId: s.automation.id,
      automationVersionId: s.version.id,
      contactId: contact.id,
      connectedAccountId: s.account.id,
      commentId: 'c_done',
    })
    comments('m1', [
      { id: 'c_ok', text: 'guide please', hoursAgo: 2 },
      { id: 'c_done', text: 'guide', hoursAgo: 3 },
      { id: 'c_no', text: 'love it', hoursAgo: 4 },
      { id: 'c_old', text: 'guide', hoursAgo: 100 },
      { id: 'c_anon', text: 'guide', hoursAgo: 5, from: null },
    ])
    const result = await data.previewRerun(s.workspaceId, s.automation.id, 72)
    expect(result).toEqual({ ok: true, preview: { found: 3, handled: 1, noMatch: 1, eligible: 1, capped: false } })
  })

  it('refuses a window that is not offered, and unknown or foreign automations', async () => {
    const s = await setup()
    const other = await createWorkspace('Other')
    expect(await data.previewRerun(s.workspaceId, s.automation.id, 999)).toMatchObject({ ok: false, code: 'bad_window' })
    expect(await data.previewRerun(other.workspaceId, s.automation.id, 72)).toMatchObject({ ok: false, code: 'not_found' })
    expect(await data.previewRerun(s.workspaceId, 'not-a-uuid', 72)).toMatchObject({ ok: false, code: 'not_found' })
    expect(await data.previewRerun(s.workspaceId, randomUUID(), 72)).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('explains why it cannot run: paused, next-post not yet picked, account needs reauth, not a comment automation', async () => {
    const paused = await setup({ status: 'paused' })
    expect(await data.previewRerun(paused.workspaceId, paused.automation.id, 72)).toMatchObject({ ok: false, code: 'not_active' })

    const next = await setup({ posts: { mode: 'next' } })
    expect(await data.previewRerun(next.workspaceId, next.automation.id, 72)).toMatchObject({ ok: false, code: 'no_post_yet' })

    const reauth = await setup()
    await db().update(connectedAccounts).set({ status: 'reauth_required' }).where(eq(connectedAccounts.id, reauth.account.id))
    expect(await data.previewRerun(reauth.workspaceId, reauth.automation.id, 72)).toMatchObject({ ok: false, code: 'account_inactive' })

    const dm = await setup()
    const dmFlow: FlowDefinition = { trigger: { type: 'any_dm' }, start: 's1', steps: { s1: { type: 'send_message', text: 'hi' } } }
    await db().update(automationVersions).set({ definition: dmFlow }).where(eq(automationVersions.id, dm.version.id))
    expect(await data.previewRerun(dm.workspaceId, dm.automation.id, 72)).toMatchObject({ ok: false, code: 'not_comment_automation' })
  })

  it('turns a revoked token into a reauth error', async () => {
    const s = await setup()
    server.use(
      http.get('https://graph.instagram.com/v24.0/m1/comments', () =>
        HttpResponse.json({ error: { message: 'Invalid OAuth access token', type: 'OAuthException', code: 190 } }, { status: 400 }),
      ),
    )
    expect(await data.previewRerun(s.workspaceId, s.automation.id, 72)).toMatchObject({ ok: false, code: 'reauth' })
  })
})

describe('startRerun and latestRerun', () => {
  it('queues a run, returns the same run on a second click, and exposes the latest', async () => {
    const s = await setup()
    expect(await data.latestRerun(s.workspaceId, s.automation.id)).toBeNull()
    const first = await data.startRerun(s.workspaceId, s.automation.id, 72)
    expect(first).toMatchObject({ ok: true, run: { status: 'queued', windowHours: 72 } })
    const second = await data.startRerun(s.workspaceId, s.automation.id, 24)
    expect(second.ok && first.ok && second.run.id === first.run.id).toBe(true)
    const rows = await db().select().from(backfillRuns).where(eq(backfillRuns.automationId, s.automation.id))
    expect(rows).toHaveLength(1)
    expect(await data.latestRerun(s.workspaceId, s.automation.id)).toMatchObject({ id: rows[0]!.id, status: 'queued' })
  })

  it('applies the same checks as the preview', async () => {
    const s = await setup({ status: 'paused' })
    expect(await data.startRerun(s.workspaceId, s.automation.id, 72)).toMatchObject({ ok: false, code: 'not_active' })
    expect(await data.startRerun(s.workspaceId, s.automation.id, 5)).toMatchObject({ ok: false, code: 'bad_window' })
  })

  it('does not show another workspace’s run', async () => {
    const s = await setup()
    const other = await createWorkspace('Other')
    await data.startRerun(s.workspaceId, s.automation.id, 72)
    expect(await data.latestRerun(other.workspaceId, s.automation.id)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @replyooo/web exec vitest run test/rerun.test.ts`
Expected: FAIL (`@/lib/rerun` and the data functions do not exist).

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/rerun.ts`:

```ts
/** Look-back options for "run on existing comments", in hours. Matches `BACKFILL_WINDOWS_HOURS` in the database package. */
export const RERUN_WINDOWS = [24, 72, 168] as const
```

Create `apps/web/src/lib/data/backfill.ts`:

```ts
import 'server-only'
import {
  automations,
  automationVersions,
  BACKFILL_MAX_COMMENTS,
  BACKFILL_WINDOWS_HOURS,
  type BackfillRun,
  connectedAccounts,
  createBackfillRun,
  handledCommentIds,
  latestBackfillRun,
} from '@replyooo/db'
import { classifyComments, type TriggerCandidate } from '@replyooo/engine'
import { gatherComments, MetaError } from '@replyooo/meta'
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { adapterFor, credentialsFor } from '../meta'
import { isUuid } from './ids'

export type RerunErrorCode =
  | 'not_found'
  | 'bad_window'
  | 'not_comment_automation'
  | 'not_active'
  | 'no_post_yet'
  | 'account_inactive'
  | 'reauth'
  | 'meta'

export interface RerunPreview {
  found: number
  handled: number
  noMatch: number
  eligible: number
  capped: boolean
}

export interface RerunRun {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed'
  windowHours: number
  found: number
  skippedHandled: number
  skippedNoMatch: number
  enqueued: number
  capped: boolean
  error: string | null
  createdAt: string
  finishedAt: string | null
}

export type RerunResult<T> = ({ ok: true } & T) | { ok: false; code: RerunErrorCode; message: string }

const fail = (code: RerunErrorCode, message: string): { ok: false; code: RerunErrorCode; message: string } => ({ ok: false, code, message })

function toRun(row: BackfillRun): RerunRun {
  return {
    id: row.id,
    status: row.status,
    windowHours: row.windowHours,
    found: row.found,
    skippedHandled: row.skippedHandled,
    skippedNoMatch: row.skippedNoMatch,
    enqueued: row.enqueued,
    capped: row.capped,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  }
}

function validWindow(hours: number): boolean {
  return (BACKFILL_WINDOWS_HOURS as readonly number[]).includes(hours)
}

/** The automation and account a re-run would use, or why it cannot run. */
async function loadTarget(workspaceId: string, automationId: string) {
  if (!isUuid(automationId)) return fail('not_found', 'Automation not found')
  const [row] = await db()
    .select({
      automation: automations,
      account: connectedAccounts,
      definition: automationVersions.definition,
      publishedAt: automationVersions.publishedAt,
    })
    .from(automations)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, automations.connectedAccountId))
    .leftJoin(automationVersions, eq(automationVersions.id, automations.currentVersionId))
    .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, automationId)))
  if (!row) return fail('not_found', 'Automation not found')
  if (!row.definition || !row.publishedAt || row.automation.status !== 'active') return fail('not_active', 'Publish and turn on the automation first')
  const trigger = row.definition.trigger
  if (trigger.type !== 'comment_keyword') return fail('not_comment_automation', 'Only comment automations can be re-run')
  if (trigger.posts.mode === 'next' && !row.automation.pinnedMediaId) {
    return fail('no_post_yet', 'This automation has not picked its post yet')
  }
  if (row.account.status !== 'active') return fail('account_inactive', 'Reconnect this account first')
  return { ok: true as const, automation: row.automation, account: row.account, trigger, publishedAt: row.publishedAt }
}

export async function previewRerun(workspaceId: string, automationId: string, windowHours: number): Promise<RerunResult<{ preview: RerunPreview }>> {
  if (!validWindow(windowHours)) return fail('bad_window', 'Pick one of the offered time ranges')
  const target = await loadTarget(workspaceId, automationId)
  if (!target.ok) return target
  const now = new Date()
  try {
    const gathered = await gatherComments(adapterFor(target.account.platform), credentialsFor(target.account), {
      trigger: target.trigger,
      pinnedMediaId: target.automation.pinnedMediaId,
      since: new Date(now.getTime() - windowHours * 3_600_000),
      max: BACKFILL_MAX_COMMENTS,
    })
    const others = gathered.comments.filter((c) => c.authorId !== target.account.externalId)
    const handled = await handledCommentIds(db(), target.account.id, others.map((c) => c.id))
    const candidate: TriggerCandidate = {
      automationId: target.automation.id,
      publishedAt: target.publishedAt,
      trigger: target.trigger,
      pinnedMediaId: target.automation.pinnedMediaId,
    }
    const buckets = classifyComments(others, candidate, handled, now)
    return {
      ok: true,
      preview: {
        found: others.length,
        handled: buckets.handled.length,
        noMatch: buckets.no_match.length + buckets.too_old.length,
        eligible: buckets.eligible.length,
        capped: gathered.capped,
      },
    }
  } catch (error) {
    if (!(error instanceof MetaError)) throw error
    if (error.kind === 'reauth') return fail('reauth', `Meta revoked access to @${target.account.username}. Reconnect it in Settings.`)
    return fail('meta', error.message)
  }
}

export async function startRerun(workspaceId: string, automationId: string, windowHours: number): Promise<RerunResult<{ run: RerunRun }>> {
  if (!validWindow(windowHours)) return fail('bad_window', 'Pick one of the offered time ranges')
  const target = await loadTarget(workspaceId, automationId)
  if (!target.ok) return target
  const { run } = await createBackfillRun(db(), {
    automationId: target.automation.id,
    connectedAccountId: target.account.id,
    windowHours,
  })
  return { ok: true, run: toRun(run) }
}

export async function latestRerun(workspaceId: string, automationId: string): Promise<RerunRun | null> {
  if (!isUuid(automationId)) return null
  const [owned] = await db()
    .select({ id: automations.id })
    .from(automations)
    .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, automationId)))
  if (!owned) return null
  const row = await latestBackfillRun(db(), automationId)
  return row ? toRun(row) : null
}
```

Add `export * from './backfill'` to `apps/web/src/lib/data/index.ts`.

Add to `apps/web/src/app/actions.ts`, after `getLinkDaily`:

```ts
export async function previewRerun(automationId: string, windowHours: number) {
  const { workspaceId } = await requireWorkspace()
  return data.previewRerun(workspaceId, automationId, windowHours)
}

export async function startRerun(automationId: string, windowHours: number) {
  const { workspaceId } = await requireWorkspace()
  const result = await data.startRerun(workspaceId, automationId, windowHours)
  if (result.ok) revalidatePath(`/automations/${automationId}`)
  return result
}

export async function getLatestRerun(automationId: string) {
  const { workspaceId } = await requireWorkspace()
  return { ok: true, run: await data.latestRerun(workspaceId, automationId) } as const
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @replyooo/web exec vitest run test/rerun.test.ts && pnpm --filter @replyooo/web typecheck`
Expected: PASS. If the Instagram graph version in tests is not `v24.0`, read `apps/web/test/setup.ts` for `META_GRAPH_VERSION` and use that in the msw URL.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): preview and start a re-run on existing comments

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Editor section, dialog and translations

**Files:**
- Create: `apps/web/src/app/(app)/automations/[id]/rerun-section.tsx`
- Modify: `apps/web/src/app/(app)/automations/[id]/editor.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/es.json`

**Interfaces:**
- Consumes: `previewRerun`, `startRerun`, `getLatestRerun` from `@/app/actions`; `RERUN_WINDOWS` from `@/lib/rerun`; types `RerunPreview`, `RerunRun`, `RerunErrorCode` from `@/lib/data`; `useDashboardFormatters` for `formatNumber`; `buttonClass`, `Button` from `@/components/ui`.
- Produces: `<RerunSection automationId={string} />`.

- [ ] **Step 1: Add the strings**

Append these keys at the end of the `automations` object in `apps/web/messages/en.json` (mind the comma after the previous last key, `last_14_days`):

```json
    "rerun_title": "Run on existing comments",
    "rerun_intro": "Reply to comments made before this automation went live, or that we missed. Instagram only allows a private reply within 7 days of a comment.",
    "rerun_button": "Run on existing comments…",
    "rerun_window": "Look back",
    "rerun_window_24": "24 hours",
    "rerun_window_72": "3 days",
    "rerun_window_168": "7 days",
    "rerun_published_only": "Runs the published version of this automation.",
    "rerun_checking": "Checking your comments…",
    "rerun_preview": "{v0} comments found · {v1} would get a reply · {v2} already handled",
    "rerun_preview_none": "No comments to reply to in this time range.",
    "rerun_preview_capped": "Showing the first {v0} comments. Run again when this finishes to cover the rest.",
    "rerun_start": "Run now",
    "rerun_starting": "Starting…",
    "rerun_status_queued": "Waiting to start…",
    "rerun_status_running": "Running…",
    "rerun_status_done": "Finished",
    "rerun_status_failed": "Failed",
    "rerun_summary": "{v0} comments found · {v1} queued for a reply · {v2} already handled · {v3} didn’t match",
    "rerun_capped_note": "Stopped at {v0} comments. Run again to continue.",
    "rerun_last_run": "Last run",
    "rerun_failed_reason": "Couldn’t finish: {v0}",
    "rerun_error_not_found": "This automation no longer exists.",
    "rerun_error_bad_window": "Pick one of the offered time ranges.",
    "rerun_error_not_comment_automation": "Only comment automations can be re-run.",
    "rerun_error_not_active": "Publish and turn on the automation first.",
    "rerun_error_no_post_yet": "This automation hasn’t picked its post yet. It picks the first post that gets a matching comment.",
    "rerun_error_account_inactive": "Reconnect this account first.",
    "rerun_error_reauth": "Meta revoked access to this account. Reconnect it in Settings.",
    "rerun_error_meta": "Couldn’t load comments from Meta: {v0}",
    "rerun_error_network": "Couldn’t reach Replyooo. Check your connection and try again."
```

and the Spanish equivalents at the end of the `automations` object in `apps/web/messages/es.json`:

```json
    "rerun_title": "Ejecutar en comentarios existentes",
    "rerun_intro": "Responde a comentarios hechos antes de que esta automatización estuviera activa, o que no recibimos. Instagram solo permite una respuesta privada dentro de los 7 días siguientes al comentario.",
    "rerun_button": "Ejecutar en comentarios existentes…",
    "rerun_window": "Período",
    "rerun_window_24": "24 horas",
    "rerun_window_72": "3 días",
    "rerun_window_168": "7 días",
    "rerun_published_only": "Se ejecuta la versión publicada de esta automatización.",
    "rerun_checking": "Revisando tus comentarios…",
    "rerun_preview": "{v0} comentarios encontrados · {v1} recibirían respuesta · {v2} ya atendidos",
    "rerun_preview_none": "No hay comentarios para responder en este período.",
    "rerun_preview_capped": "Se muestran los primeros {v0} comentarios. Vuelve a ejecutarlo cuando termine para cubrir el resto.",
    "rerun_start": "Ejecutar ahora",
    "rerun_starting": "Iniciando…",
    "rerun_status_queued": "Esperando para empezar…",
    "rerun_status_running": "En curso…",
    "rerun_status_done": "Terminado",
    "rerun_status_failed": "Falló",
    "rerun_summary": "{v0} comentarios encontrados · {v1} en cola para responder · {v2} ya atendidos · {v3} no coincidieron",
    "rerun_capped_note": "Se detuvo en {v0} comentarios. Vuelve a ejecutarlo para continuar.",
    "rerun_last_run": "Última ejecución",
    "rerun_failed_reason": "No se pudo terminar: {v0}",
    "rerun_error_not_found": "Esta automatización ya no existe.",
    "rerun_error_bad_window": "Elige uno de los períodos disponibles.",
    "rerun_error_not_comment_automation": "Solo las automatizaciones de comentarios se pueden volver a ejecutar.",
    "rerun_error_not_active": "Primero publica y activa la automatización.",
    "rerun_error_no_post_yet": "Esta automatización aún no ha elegido su publicación. Elige la primera publicación que reciba un comentario que coincida.",
    "rerun_error_account_inactive": "Primero vuelve a conectar esta cuenta.",
    "rerun_error_reauth": "Meta revocó el acceso a esta cuenta. Vuelve a conectarla en Ajustes.",
    "rerun_error_meta": "No se pudieron cargar los comentarios de Meta: {v0}",
    "rerun_error_network": "No se pudo conectar con Replyooo. Revisa tu conexión e inténtalo de nuevo."
```

- [ ] **Step 2: Check the catalogs**

Run: `pnpm --filter @replyooo/web translations:check`
Expected: PASS (both catalogs have the same keys and arguments; ICU syntax valid). The typographic apostrophes (’) are intentional: a straight `'` is an escape character in ICU messages.

- [ ] **Step 3: Create the component**

Create `apps/web/src/app/(app)/automations/[id]/rerun-section.tsx`:

```tsx
'use client'

import { Loader2, RotateCw, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { getLatestRerun, previewRerun, startRerun } from '@/app/actions'
import { buttonClass, cx } from '@/components/ui'
import { useDashboardFormatters } from '@/i18n/use-format'
import type { RerunErrorCode, RerunPreview, RerunRun } from '@/lib/data'
import { RERUN_WINDOWS } from '@/lib/rerun'

type Failure = { code: RerunErrorCode | 'network'; message: string }
type PreviewState = { kind: 'loading' } | { kind: 'error'; failure: Failure } | { kind: 'ready'; preview: RerunPreview }

const POLL_MS = 5000

function useErrorText() {
  const tr = useTranslations('automations')
  return (failure: Failure) =>
    failure.code === 'meta' ? tr('rerun_error_meta', { v0: failure.message }) : tr(`rerun_error_${failure.code}`)
}

/** Reply to comments that already exist on this automation's posts. Shown for live comment automations. */
export function RerunSection({ automationId }: { automationId: string }) {
  const tr = useTranslations('automations')
  const { formatNumber } = useDashboardFormatters()
  const [latest, setLatest] = useState<RerunRun | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    getLatestRerun(automationId).then((result) => {
      if (!cancelled) setLatest(result.run)
    })
    return () => {
      cancelled = true
    }
  }, [automationId])

  const active = latest?.status === 'queued' || latest?.status === 'running'
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      getLatestRerun(automationId).then((result) => setLatest(result.run))
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [active, automationId])

  return (
    <section className="mt-6 rounded-[18px] border border-line bg-white p-5" aria-labelledby="rerun-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="rerun-title" className="text-[15px] font-semibold">
            {tr('rerun_title')}
          </h2>
          <p className="mt-1 text-[12.5px] text-subtle">{tr('rerun_intro')}</p>
        </div>
        <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => setOpen(true)} disabled={active}>
          <RotateCw className="size-4" aria-hidden /> {tr('rerun_button')}
        </button>
      </div>

      {latest && (
        <div className="mt-4 rounded-xl bg-sand px-4 py-3 text-[13px]" aria-live="polite">
          <p className="font-medium">
            {tr('rerun_last_run')} · {tr(`rerun_status_${latest.status}`)}
            {active && <Loader2 className="ml-2 inline size-3.5 animate-spin align-[-2px]" aria-hidden />}
          </p>
          {latest.status === 'done' && (
            <p className="mt-1 text-muted">
              {tr('rerun_summary', {
                v0: formatNumber(latest.found),
                v1: formatNumber(latest.enqueued),
                v2: formatNumber(latest.skippedHandled),
                v3: formatNumber(latest.skippedNoMatch),
              })}
            </p>
          )}
          {latest.status === 'done' && latest.capped && <p className="mt-1 text-muted">{tr('rerun_capped_note', { v0: formatNumber(500) })}</p>}
          {latest.status === 'failed' && <p className="mt-1 text-brand">{tr('rerun_failed_reason', { v0: latest.error ?? '' })}</p>}
        </div>
      )}

      {open && (
        <RerunDialog
          automationId={automationId}
          onClose={() => setOpen(false)}
          onStarted={(run) => {
            setLatest(run)
            setOpen(false)
          }}
        />
      )}
    </section>
  )
}

function RerunDialog({
  automationId,
  onClose,
  onStarted,
}: {
  automationId: string
  onClose: () => void
  onStarted: (run: RerunRun) => void
}) {
  const tr = useTranslations('automations')
  const shared = useTranslations('shared')
  const { formatNumber } = useDashboardFormatters()
  const errorText = useErrorText()
  const [windowHours, setWindowHours] = useState<(typeof RERUN_WINDOWS)[number]>(72)
  const [preview, setPreview] = useState<PreviewState>({ kind: 'loading' })
  const [startError, setStartError] = useState<Failure | null>(null)
  const [starting, startTransition] = useTransition()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    setPreview({ kind: 'loading' })
    setStartError(null)
    previewRerun(automationId, windowHours)
      .then((result) => {
        if (cancelled) return
        setPreview(
          result.ok ? { kind: 'ready', preview: result.preview } : { kind: 'error', failure: { code: result.code, message: result.message } },
        )
      })
      .catch(() => {
        if (!cancelled) setPreview({ kind: 'error', failure: { code: 'network', message: '' } })
      })
    return () => {
      cancelled = true
    }
  }, [automationId, windowHours])

  const canStart = preview.kind === 'ready' && preview.preview.eligible > 0 && !starting

  const start = () =>
    startTransition(async () => {
      try {
        const result = await startRerun(automationId, windowHours)
        if (result.ok) onStarted(result.run)
        else setStartError({ code: result.code, message: result.message })
      } catch {
        setStartError({ code: 'network', message: '' })
      }
    })

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={tr('rerun_title')}>
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full max-w-[460px] rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[16px] font-semibold">{tr('rerun_title')}</h2>
          <button type="button" aria-label={shared('close')} onClick={onClose} className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-sand">
            <X className="size-4" />
          </button>
        </div>

        <fieldset className="mt-4">
          <legend className="text-[12.5px] font-medium text-muted">{tr('rerun_window')}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {RERUN_WINDOWS.map((hours) => (
              <label
                key={hours}
                className={cx(
                  'cursor-pointer rounded-full border px-3 py-1.5 text-[13px] font-medium',
                  windowHours === hours ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:bg-sand',
                )}
              >
                <input type="radio" name="rerun-window" className="sr-only" checked={windowHours === hours} onChange={() => setWindowHours(hours)} />
                {tr(`rerun_window_${hours}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-4 min-h-[44px] text-[13px]" aria-live="polite">
          {preview.kind === 'loading' && (
            <p className="flex items-center gap-2 text-subtle">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> {tr('rerun_checking')}
            </p>
          )}
          {preview.kind === 'error' && <p className="text-brand">{errorText(preview.failure)}</p>}
          {preview.kind === 'ready' &&
            (preview.preview.found === 0 || preview.preview.eligible === 0 ? (
              <>
                <p className="text-muted">
                  {preview.preview.found > 0
                    ? tr('rerun_preview', {
                        v0: formatNumber(preview.preview.found),
                        v1: formatNumber(preview.preview.eligible),
                        v2: formatNumber(preview.preview.handled),
                      })
                    : tr('rerun_preview_none')}
                </p>
              </>
            ) : (
              <p className="text-ink">
                {tr('rerun_preview', {
                  v0: formatNumber(preview.preview.found),
                  v1: formatNumber(preview.preview.eligible),
                  v2: formatNumber(preview.preview.handled),
                })}
              </p>
            ))}
          {preview.kind === 'ready' && preview.preview.capped && (
            <p className="mt-1 text-subtle">{tr('rerun_preview_capped', { v0: formatNumber(500) })}</p>
          )}
          {startError && <p className="mt-1 text-brand">{errorText(startError)}</p>}
        </div>

        <p className="mt-2 text-[12px] text-subtle">{tr('rerun_published_only')}</p>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={buttonClass('secondary', 'sm')} onClick={onClose}>
            {shared('cancel')}
          </button>
          <button type="button" className={buttonClass('primary', 'sm')} onClick={start} disabled={!canStart}>
            {starting ? tr('rerun_starting') : tr('rerun_start')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
```

- [ ] **Step 4: Render it in the editor**

In `apps/web/src/app/(app)/automations/[id]/editor.tsx`, add the import next to the `LinkInsights` import:

```tsx
import { RerunSection } from './rerun-section'
```

and render it directly after the existing line

```tsx
          {status !== 'draft' && stats.recipients > 0 && <LinkInsights automationId={automation.id} />}
```

as:

```tsx
          {status === 'active' && automation.flow.trigger.type === 'comment_keyword' && <RerunSection automationId={automation.id} />}
```

- [ ] **Step 5: Typecheck, lint and run the web suite**

Run: `pnpm --filter @replyooo/web typecheck && pnpm --filter @replyooo/web translations:check && pnpm --filter @replyooo/web test`
Expected: PASS. If `buttonClass`'s second argument or `shared('close')` / `shared('cancel')` differ from usage elsewhere (they are used by `confirm-action.tsx`), match that file.

- [ ] **Step 6: Check it in the browser**

Start the dev stack the way `docs/handoffs/2026-10-13-link-click-tracking.md` describes for its browser check, open a published comment automation, and confirm: the "Run on existing comments" card shows; the dialog opens; with the demo account (revoked access) the dialog shows the "Meta revoked access" error and "Run now" stays disabled; Escape and Cancel close it; the card does not show for DM automations or drafts; the page works in Spanish (switch the dashboard language). A real run against Meta is covered by the pending phone test (Task 7).

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): run on existing comments from the automation editor

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs, pending test note and final verification

**Files:**
- Modify: `docs/superpowers/specs/2026-10-13-rerun-on-existing-comments-design.md`
- Modify: `docs/competitors/reachlee.md`
- Modify: `/Users/hyyashu/.claude/projects/-Users-hyyashu-Projects-Replyooo/memory/pending-real-world-tests.md`

- [ ] **Step 1: Bring the spec in line with what was built**

In the spec:
- Section 6 step 2, `any` bullet: replace "lists recent media via `adapter.listMedia` and keeps posts published inside the window" with "scans the account's 24 most recent posts (`adapter.listMedia`), because a recent comment can be on an older post".
- Section 6 last bullet: replace the sentence about `retryable` retries with "A Meta error ends the run as `failed` with a reason (`reauth` also flags the account); there is no automatic retry, the user runs it again."
- Section 3: drop the sentence "The outcome of each comment ... summary after the run reads them." and state that the summary shows the stored counts (found, queued, already handled, no match).
- Section 7: replace "the editor and the automations list menu" with "the editor" and note the list menu is a possible follow-up; replace the summary sentence with "(replies queued, already handled, no match, stopped at the cap)".
- Section 8: delete the sentence saying comments past the plan limit show up as "limit reached"; replace with "Comments queued for a contact the plan no longer covers are dropped by the normal plan check and are not counted separately."
- Section 4: replace "confirmed against Meta's docs while writing the implementation plan" with "Confirmed against Meta's docs on 2026-10-13: `/{post-id}/comments` accepts `filter`, `order` and `since`; ordering may be ranked regardless of `order`, so the gather helper filters by time itself."
- Section 10: remove the first open item. Replace the second with "Whether a capped run should offer a 'continue' button instead of 'run again'."
- Status line: `Status: approved, implemented on branch feat/rerun-existing-comments.`

- [ ] **Step 2: Update the competitor note**

In `docs/competitors/reachlee.md`, change the table row `| **Re-run on old posts** | Yes (Pro) | **No** |` to `| Re-run on old posts | Yes (Pro) | Yes, "Run on existing comments", last 7 days (built 2026-10-13, not yet deployed) |` and remove "scheduled DMs and re-run on old posts" wording from priority 3 so it reads "**Inbox**, then scheduled DMs."

- [ ] **Step 3: Add the live test to the pending list**

Append to `/Users/hyyashu/.claude/projects/-Users-hyyashu-Projects-Replyooo/memory/pending-real-world-tests.md` under a new heading "Run on existing comments: pending live test":
- On a connected account with a post that already has a comment matching a published automation: open the automation, run on existing comments for 3 days, confirm the preview counts, run it, and confirm the commenter receives the public reply and DM exactly once.
- Run it a second time and confirm nothing is sent again.
- Confirm the Instagram `from.id` field is actually returned by `/{media-id}/comments` for a real commenter (the docs say it is).
- Confirm Facebook returns `from` for Page post comments with a Page token.

- [ ] **Step 4: Run everything**

Run: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`
Expected: all packages pass (db, meta, engine, worker, web; email and shared unaffected). Then `pnpm --filter @replyooo/web translations:check`. Run `git diff main --stat` and confirm only the files named in this plan changed, plus the generated migration files.

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: align the re-run spec with the build and update the competitor note

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Hand off**

Do not merge or push without the user's go-ahead. Report: branch name, what is verified (automated suites, browser check of the UI states), what is not (a real Meta run, which stays on the pending list), and that migration `0010` runs on the next deploy. The dev-DB note from link tracking (old `0008` tracking tables) is unrelated to this migration.
