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
