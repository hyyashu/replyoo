import { connectedAccounts, contacts, flowRuns, messages, trackedLinks, usageCounters } from '@replyooo/db'
import { MetaError } from '@replyooo/meta'
import type { FlowDefinition } from '@replyooo/shared'
import { decodePostback } from '@replyooo/shared'
import { and, eq, inArray } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { OutboundBody } from '../src/flow'
import { handleOutbound, withTrackedLinks } from '../src/outbound'
import { createTestContext, insertRun, NOW, publishAutomation, seedAccount, seedContact, seedMember } from './support'

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
  const statuses = async (ids: string[]) => {
    const rows = await db.select().from(messages).where(inArray(messages.id, ids))
    return ids.map((id) => {
      const m = rows.find((row) => row.id === id)
      return [id, m?.status, m?.error]
    })
  }
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
            { type: 'url', label: 'Shop', url: expect.stringMatching(/^http:\/\/localhost:3000\/l\/[0-9A-Za-z]{8}$/) },
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
    const { db, deps, adapters, account, run, queue, statuses, mailer } = await setup()
    await seedMember(db, account.workspaceId, 'owner')
    adapters.instagram.errors.push(new MetaError('reauth', 'expired', { reason: 'token_invalid' }))
    const ids = await queue({ kind: 'dm', body: text('hi') })
    await expect(handleOutbound(deps, { messageIds: ids })).resolves.toEqual({ status: 'done' })
    expect(await statuses(ids)).toEqual([[ids[0], 'failed', 'token_invalid']])
    const [acct] = await db.select().from(connectedAccounts).where(eq(connectedAccounts.id, account.id))
    expect(acct?.status).toBe('reauth_required')
    const [after] = await db.select().from(flowRuns).where(eq(flowRuns.id, run.id))
    expect(after).toMatchObject({ status: 'failed', error: 'token_invalid' })
    expect(mailer.sent).toHaveLength(1)
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

describe('link tracking', () => {
  const shop = (url = 'https://shop.example/a'): OutboundBody => ({
    type: 'message',
    message: {
      text: 'Want it?',
      buttons: [
        { type: 'url', label: 'Shop', url },
        { type: 'reply', label: 'Send it', stepId: 's1', buttonId: 'b1' },
        { type: 'url', label: 'Docs', url: 'https://docs.example/b' },
      ],
    },
  })

  const sentButtons = (adapters: Awaited<ReturnType<typeof setup>>['adapters']) =>
    (adapters.instagram.sent('sendMessage')[0]?.args[1] as { buttons: { type: string; label: string; url?: string }[] }).buttons

  it('sends a tracked link for each url button and keeps the real destination in the database', async () => {
    const { db, deps, adapters, contact, run, queue } = await setup()
    const [id] = await queue({ kind: 'dm', body: shop() })
    await handleOutbound(deps, { messageIds: [id!] })

    const rows = await db.select().from(trackedLinks).where(eq(trackedLinks.messageId, id!))
    expect(rows.map((r) => [r.position, r.url]).sort()).toEqual([
      [0, 'https://shop.example/a'],
      [2, 'https://docs.example/b'],
    ])
    expect(rows.every((r) => r.contactId === contact.id)).toBe(true)
    const [runRow] = await db.select().from(flowRuns).where(eq(flowRuns.id, run.id))
    expect(rows.every((r) => r.automationId === runRow!.automationId)).toBe(true)

    const byPosition = Object.fromEntries(rows.map((r) => [r.position, r.code]))
    const buttons = sentButtons(adapters)
    expect(buttons[0]).toEqual({ type: 'url', label: 'Shop', url: `http://localhost:3000/l/${byPosition[0]}` })
    expect(buttons[1]?.type).toBe('postback')
    expect(buttons[2]).toEqual({ type: 'url', label: 'Docs', url: `http://localhost:3000/l/${byPosition[2]}` })
  })

  it('uses the app URL without a trailing slash', async () => {
    const { deps, adapters, queue } = await setup()
    const [id] = await queue({ kind: 'dm', body: shop() })
    await handleOutbound({ ...deps, appUrl: 'https://app.example.com/' }, { messageIds: [id!] })
    expect(sentButtons(adapters)[0]?.url).toMatch(/^https:\/\/app\.example\.com\/l\/[0-9A-Za-z]{8}$/)
  })

  it('reuses the same codes when a message is retried', async () => {
    const { db, deps, adapters, queue } = await setup()
    const [id] = await queue({ kind: 'dm', body: shop() })
    const [row] = await db.select().from(messages).where(eq(messages.id, id!))

    const first = await withTrackedLinks(deps, row!)
    const second = await withTrackedLinks(deps, row!)
    expect(second.body).toEqual(first.body)
    expect(await db.select().from(trackedLinks).where(eq(trackedLinks.messageId, id!))).toHaveLength(2)
    expect(adapters.instagram.sent()).toEqual([])
  })

  it('tracks private replies too', async () => {
    const { db, deps, queue } = await setup()
    const [id] = await queue({ kind: 'private_reply', commentId: 'c-link-tracking', body: shop() })
    await handleOutbound(deps, { messageIds: [id!] })
    expect(await db.select().from(trackedLinks).where(eq(trackedLinks.messageId, id!))).toHaveLength(2)
  })

  it('leaves messages without url buttons, images and comment replies alone', async () => {
    const { db, deps, adapters, queue } = await setup()
    const ids = await queue(
      { kind: 'dm', body: { type: 'image', url: 'https://img.example/a.png' } },
      { kind: 'dm', body: text('plain') },
      { kind: 'dm', body: { type: 'message', message: { text: 'Pick', buttons: [{ type: 'reply', label: 'Yes', stepId: 's1', buttonId: 'b1' }] } } },
      { kind: 'comment_reply', commentId: 'c-link-tracking-reply', body: { type: 'comment', text: 'Check your DMs https://x.example/y' } },
    )
    await handleOutbound(deps, { messageIds: ids })
    expect(await db.select().from(trackedLinks).where(inArray(trackedLinks.messageId, ids))).toEqual([])
    expect(adapters.instagram.sent('sendMessage')).toHaveLength(3)
  })

  it('falls back to the original links when tracking fails', async () => {
    const { db, deps, queue } = await setup()
    const [id] = await queue({ kind: 'dm', body: shop() })
    const [row] = await db.select().from(messages).where(eq(messages.id, id!))
    const failing = async () => {
      throw new Error('database unavailable')
    }
    const result = await withTrackedLinks(deps, row!, failing)
    expect(result).toBe(row)
  })

  it('sends the original links when the message has no flow run to attribute them to', async () => {
    const { db, deps, adapters, queue } = await setup()
    const [id] = await queue({ kind: 'dm', body: shop() })
    await db.update(messages).set({ flowRunId: null }).where(eq(messages.id, id!))
    await handleOutbound(deps, { messageIds: [id!] })
    expect(sentButtons(adapters)[0]?.url).toBe('https://shop.example/a')
    expect(await db.select().from(trackedLinks).where(eq(trackedLinks.messageId, id!))).toEqual([])
  })

  const carousel = (): OutboundBody => ({
    type: 'message',
    message: {
      text: '',
      cards: [
        { title: 'Mug', button: { label: 'Buy', url: 'https://shop.example/mug' } },
        { title: 'Cap', subtitle: '$19', imageUrl: 'https://cdn.example/cap.jpg', button: { label: 'Buy', url: 'https://shop.example/cap' } },
      ],
    },
  })

  type SentCarousel = { kind: string; cards: { title: string; subtitle?: string; imageUrl?: string; button: { label: string; url: string } }[] }
  const sentCarousel = (adapters: Awaited<ReturnType<typeof setup>>['adapters']) =>
    adapters.instagram.sent('sendMessage')[0]?.args[1] as SentCarousel

  it('sends a carousel with a tracked link per card and keeps the real destinations in the database', async () => {
    const { db, deps, adapters, queue } = await setup()
    const [id] = await queue({ kind: 'dm', body: carousel() })
    await handleOutbound(deps, { messageIds: [id!] })

    const rows = await db.select().from(trackedLinks).where(eq(trackedLinks.messageId, id!))
    expect(rows.map((r) => [r.position, r.url]).sort()).toEqual([
      [0, 'https://shop.example/mug'],
      [1, 'https://shop.example/cap'],
    ])
    const byPosition = Object.fromEntries(rows.map((r) => [r.position, r.code]))
    const sent = sentCarousel(adapters)
    expect(sent.kind).toBe('carousel')
    expect(sent.cards[0]).toEqual({ title: 'Mug', button: { label: 'Buy', url: `http://localhost:3000/l/${byPosition[0]}` } })
    expect(sent.cards[1]).toEqual({
      title: 'Cap',
      subtitle: '$19',
      imageUrl: 'https://cdn.example/cap.jpg',
      button: { label: 'Buy', url: `http://localhost:3000/l/${byPosition[1]}` },
    })
  })

  it('reuses the same carousel codes when a message is retried', async () => {
    const { deps, queue, db } = await setup()
    const [id] = await queue({ kind: 'dm', body: carousel() })
    const [row] = await db.select().from(messages).where(eq(messages.id, id!))
    const first = await withTrackedLinks(deps, row!)
    const second = await withTrackedLinks(deps, row!)
    expect(second.body).toEqual(first.body)
    expect(first.body).not.toEqual(row!.body)
  })

  it('falls back to the original card links when tracking fails', async () => {
    const { deps, queue, db } = await setup()
    const [id] = await queue({ kind: 'dm', body: carousel() })
    const [row] = await db.select().from(messages).where(eq(messages.id, id!))
    const failing = async () => {
      throw new Error('db down')
    }
    const result = await withTrackedLinks(deps, row!, failing as never)
    expect(result.body).toEqual(row!.body)
  })
})
