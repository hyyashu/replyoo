import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { FlowDefinition } from '@replyooo/shared'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../src'
import {
  answeredCommentIds,
  authUsers,
  automationEntries,
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
  await db.insert(authUsers).values({ id: 'x', name: 'Owner', email: 'x@example.com' }).onConflictDoNothing()
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

describe('queued runs nobody picked up', () => {
  it('fails a run that has been queued for over 30 minutes, so it cannot block the automation', async () => {
    const stale = await seed()
    const fresh = await seed()
    const now = new Date()
    const staleRun = (await createBackfillRun(db, { automationId: stale.automation.id, connectedAccountId: stale.account.id, windowHours: 24 })).run
    const freshRun = (await createBackfillRun(db, { automationId: fresh.automation.id, connectedAccountId: fresh.account.id, windowHours: 24 })).run
    await db.update(backfillRuns).set({ createdAt: new Date(now.getTime() - 31 * 60_000) }).where(eq(backfillRuns.id, staleRun.id))
    await failStuckBackfillRuns(db, now)
    const [s] = await db.select().from(backfillRuns).where(eq(backfillRuns.id, staleRun.id))
    const [f] = await db.select().from(backfillRuns).where(eq(backfillRuns.id, freshRun.id))
    expect(s).toMatchObject({ status: 'failed', error: 'timed_out' })
    expect(f?.status).toBe('queued')
    expect((await createBackfillRun(db, { automationId: stale.automation.id, connectedAccountId: stale.account.id, windowHours: 24 })).created).toBe(true)
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

describe('answeredCommentIds', () => {
  it('also leaves alone comments by someone this automation already ran for, even if that comment itself was never answered', async () => {
    const s = await seed()
    const other = await seed()
    await db.insert(automationEntries).values({
      automationId: s.automation.id,
      contactId: s.contact.id,
      lastEnteredAt: new Date(Date.now() - 50 * 3_600_000),
    })
    const comments = [
      { id: `c_repeat_${randomUUID()}`, authorId: s.contact.platformUserId },
      { id: `c_new_${randomUUID()}`, authorId: `psid_new_${randomUUID()}` },
    ]
    const answered = await answeredCommentIds(db, { accountId: s.account.id, automationId: s.automation.id, comments })
    expect([...answered]).toEqual([comments[0]!.id])

    // An entry for a different automation, or on another account, does not count.
    const elsewhere = await answeredCommentIds(db, { accountId: other.account.id, automationId: other.automation.id, comments })
    expect(elsewhere.size).toBe(0)
  })

  it('keeps counting comments with a run or an outbound reply', async () => {
    const s = await seed()
    const id = `c_run_${randomUUID()}`
    await db.insert(flowRuns).values({
      automationId: s.automation.id,
      automationVersionId: s.version.id,
      contactId: s.contact.id,
      connectedAccountId: s.account.id,
      commentId: id,
    })
    const answered = await answeredCommentIds(db, {
      accountId: s.account.id,
      automationId: s.automation.id,
      comments: [{ id, authorId: 'someone_else' }],
    })
    expect(answered.has(id)).toBe(true)
  })

  it('returns an empty set for no comments', async () => {
    const s = await seed()
    expect((await answeredCommentIds(db, { accountId: s.account.id, automationId: s.automation.id, comments: [] })).size).toBe(0)
  })
})
