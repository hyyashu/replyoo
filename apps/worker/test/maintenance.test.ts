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
