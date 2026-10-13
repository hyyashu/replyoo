import { automations, backfillRuns, connectedAccounts, createBackfillRun, flowRuns, messages, webhookEvents } from '@replyooo/db'
import { MetaError, type NormalizedEvent } from '@replyooo/meta'
import type { FlowDefinition } from '@replyooo/shared'
import { eq, like } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { handleBackfill } from '../src/backfill'
import { handleInbound } from '../src/inbound'
import { createTestContext, insertRun, listedComment, NOW, publishAutomation, seedAccount, seedContact } from './support'

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

const commentFlow = (
  posts: { mode: 'any' } | { mode: 'specific'; mediaIds: string[] } = { mode: 'specific', mediaIds: ['media1'] },
): FlowDefinition => ({
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
    const order = await Promise.all(
      jobs.inbounds.map(
        async (id) => ((await db.select().from(webhookEvents).where(eq(webhookEvents.id, id)))[0]!.payload as { commentId: string }).commentId,
      ),
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

  it('end to end: the same person commenting twice gets one flow', async () => {
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
