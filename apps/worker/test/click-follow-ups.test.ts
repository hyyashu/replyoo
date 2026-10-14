import { automations, clickFollowUps, connectedAccounts, flowRuns, linkClicks, messages, trackedLinks } from '@replyooo/db'
import type { FlowDefinition } from '@replyooo/shared'
import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { followUpBodies, sendDueClickFollowUps } from '../src/click-follow-ups'
import type { OutboundBody } from '../src/flow'
import { handleOutbound } from '../src/outbound'
import { sweep } from '../src/maintenance'
import { createTestContext, insertRun, NOW, publishAutomation, seedAccount, seedContact } from './support'

const flow: FlowDefinition = {
  trigger: { type: 'any_dm' },
  start: 's1',
  steps: { s1: { type: 'send_message', text: 'hi' } },
}

const HOUR = 60 * 60_000
const followUp = { afterMinutes: 60, text: 'Still want the guide?' }
const linkBody: OutboundBody = {
  type: 'message',
  message: {
    text: 'Here it is',
    buttons: [
      { type: 'url', label: 'Open', url: 'https://example.com/guide' },
      { type: 'reply', label: 'More', stepId: 's1', buttonId: 'more' },
    ],
    followUp,
  },
}
const cards = [
  { title: 'Mug', button: { label: 'Buy', url: 'https://shop.example.com/mug' } },
  { title: 'Cap', button: { label: 'See it', url: 'https://shop.example.com/cap' } },
]
const carouselBody: OutboundBody = { type: 'message', message: { text: '', cards, followUp } }

async function setup(body: OutboundBody = linkBody) {
  const ctx = createTestContext()
  const db = ctx.deps.db
  const { account } = await seedAccount(db)
  const published = await publishAutomation(db, account, flow)
  const contact = await seedContact(db, account)
  const run = await insertRun(db, { account, contact, ...published }, { status: 'completed' })
  const [message] = await db
    .insert(messages)
    .values({
      contactId: contact.id,
      connectedAccountId: account.id,
      flowRunId: run.id,
      direction: 'out',
      kind: 'dm',
      body: body as unknown as Record<string, unknown>,
      status: 'queued',
    })
    .returning()
  await handleOutbound(ctx.deps, { messageIds: [message!.id] })
  ctx.jobs.clear()
  const followUpRow = async () => {
    const [row] = await db.select().from(clickFollowUps).where(eq(clickFollowUps.messageId, message!.id))
    return row
  }
  const later = (ms: number) => {
    ctx.clock.now = new Date(NOW.getTime() + ms)
  }
  return { ...ctx, db, account, contact, run, automation: published.automation, message: message!, followUpRow, later }
}

describe('click follow-ups', () => {
  it('schedules one follow-up when the message is sent, and none on a repeat', async () => {
    const { deps, message, followUpRow, db } = await setup()
    const row = await followUpRow()
    expect(row).toMatchObject({ status: 'pending', text: followUp.text, dueAt: new Date(NOW.getTime() + HOUR) })
    await handleOutbound(deps, { messageIds: [message.id] })
    expect(await db.select().from(clickFollowUps).where(eq(clickFollowUps.messageId, message.id))).toHaveLength(1)
  })

  it('schedules nothing for a message without a follow-up', async () => {
    const { followUpRow } = await setup({ type: 'message', message: { text: 'plain' } })
    expect(await followUpRow()).toBeUndefined()
  })

  it('waits until it is due', async () => {
    const { deps, followUpRow, later } = await setup()
    later(HOUR - 60_000)
    await sendDueClickFollowUps(deps)
    expect((await followUpRow())?.status).toBe('pending')
  })

  it('sends the text with the same link buttons once, and tracks the new links', async () => {
    const { deps, jobs, adapters, followUpRow, later, db, run } = await setup()
    later(HOUR)
    await sendDueClickFollowUps(deps)
    await sendDueClickFollowUps(deps)
    const row = await followUpRow()
    expect(row).toMatchObject({ status: 'sent', reason: null })
    expect(jobs.outbounds).toContainEqual({ messageIds: [row!.followUpMessageId] })
    // Two sweeps, one follow-up: the run has the original message and one more.
    expect(await db.select({ id: messages.id }).from(messages).where(eq(messages.flowRunId, run.id))).toHaveLength(2)

    const [sent] = await db.select().from(messages).where(eq(messages.id, row!.followUpMessageId!))
    expect(sent).toMatchObject({ kind: 'dm', flowRunId: run.id, status: 'queued' })
    expect(sent!.body).toEqual({
      type: 'message',
      message: { text: followUp.text, buttons: [{ type: 'url', label: 'Open', url: 'https://example.com/guide' }] },
    })

    adapters.instagram.calls.length = 0
    await handleOutbound(deps, { messageIds: [sent!.id] })
    const links = await db.select().from(trackedLinks).where(eq(trackedLinks.messageId, sent!.id))
    expect(links).toHaveLength(1)
    const call = adapters.instagram.sent('sendMessage')[0]!
    expect(JSON.stringify(call.args)).toContain(`/l/${links[0]!.code}`)
    // The follow-up itself never schedules another one.
    expect(await db.select().from(clickFollowUps).where(eq(clickFollowUps.messageId, sent!.id))).toHaveLength(0)
  })

  it('sends the text and then the same carousel', async () => {
    const { deps, jobs, later, db, followUpRow } = await setup(carouselBody)
    later(HOUR)
    await sendDueClickFollowUps(deps)
    const row = await followUpRow()
    const ids = jobs.outbounds.find((job) => job.messageIds.includes(row!.followUpMessageId!))!.messageIds
    const rows = await db.select().from(messages).where(eq(messages.flowRunId, row!.flowRunId!))
    const bodies = ids.map((id) => rows.find((r) => r.id === id)!.body)
    expect(bodies).toEqual([
      { type: 'message', message: { text: followUp.text } },
      { type: 'message', message: { text: '', cards } },
    ])
  })

  it('skips when a link of the original message was opened', async () => {
    const { deps, jobs, followUpRow, later, db, message } = await setup()
    const [link] = await db.select().from(trackedLinks).where(eq(trackedLinks.messageId, message.id))
    await db.insert(linkClicks).values({ linkId: link!.id })
    later(HOUR)
    await sendDueClickFollowUps(deps)
    expect(await followUpRow()).toMatchObject({ status: 'skipped', reason: 'clicked' })
    expect(jobs.outbounds.flatMap((job) => job.messageIds)).not.toContain((await followUpRow())!.followUpMessageId)
  })

  it('skips a carousel when any card was opened', async () => {
    const { deps, followUpRow, later, db, message } = await setup(carouselBody)
    const links = await db.select().from(trackedLinks).where(eq(trackedLinks.messageId, message.id)).orderBy(asc(trackedLinks.position))
    await db.insert(linkClicks).values({ linkId: links[1]!.id })
    later(HOUR)
    await sendDueClickFollowUps(deps)
    expect(await followUpRow()).toMatchObject({ status: 'skipped', reason: 'clicked' })
  })

  it('skips once the 24-hour window has closed', async () => {
    const { deps, followUpRow, later } = await setup()
    later(24 * HOUR + 60_000)
    await sendDueClickFollowUps(deps)
    expect(await followUpRow()).toMatchObject({ status: 'skipped', reason: 'window_closed' })
  })

  it('skips when the account needs reconnecting', async () => {
    const { deps, followUpRow, later, db, account } = await setup()
    await db.update(connectedAccounts).set({ status: 'reauth_required' }).where(eq(connectedAccounts.id, account.id))
    later(HOUR)
    await sendDueClickFollowUps(deps)
    expect(await followUpRow()).toMatchObject({ status: 'skipped', reason: 'account_inactive' })
  })

  it('skips when the automation was paused or deleted', async () => {
    const paused = await setup()
    await paused.db.update(automations).set({ status: 'paused' }).where(eq(automations.id, paused.automation.id))
    paused.later(HOUR)
    await sendDueClickFollowUps(paused.deps)
    expect(await paused.followUpRow()).toMatchObject({ status: 'skipped', reason: 'automation_inactive' })

    const deleted = await setup()
    await deleted.db.delete(automations).where(eq(automations.id, deleted.automation.id))
    deleted.later(HOUR)
    await sendDueClickFollowUps(deleted.deps)
    expect(await deleted.followUpRow()).toMatchObject({ status: 'skipped', reason: 'automation_inactive' })
  })

  it('skips while the contact is in another conversation', async () => {
    const { deps, followUpRow, later, db, account, contact } = await setup()
    const other = await publishAutomation(db, account, flow)
    await insertRun(db, { account, contact, ...other }, { status: 'waiting', wait: { kind: 'postback' }, stateVersion: 1 })
    later(HOUR)
    await sendDueClickFollowUps(deps)
    expect(await followUpRow()).toMatchObject({ status: 'skipped', reason: 'in_conversation' })
  })

  it('runs from the sweep', async () => {
    const { deps, followUpRow, later } = await setup()
    later(HOUR)
    await sweep(deps)
    expect((await followUpRow())?.status).toBe('sent')
  })

  it('leaves the finished run alone when the follow-up fails', async () => {
    const { deps, followUpRow, later, db, run, account } = await setup()
    later(HOUR)
    await sendDueClickFollowUps(deps)
    await db.update(connectedAccounts).set({ status: 'reauth_required' }).where(eq(connectedAccounts.id, account.id))
    const followUpMessageId = (await followUpRow())!.followUpMessageId!
    await handleOutbound(deps, { messageIds: [followUpMessageId] })
    const [sent] = await db.select().from(messages).where(eq(messages.id, followUpMessageId))
    expect(sent).toMatchObject({ status: 'failed', error: 'account_inactive' })
    const [after] = await db.select().from(flowRuns).where(eq(flowRuns.id, run.id))
    expect(after!.status).toBe('completed')
  })
})

describe('followUpBodies', () => {
  it('has nothing to repeat for a message without links', () => {
    expect(followUpBodies({ type: 'message', message: { text: 'hi' } }, 'again')).toEqual([])
    expect(followUpBodies({ type: 'image', url: 'https://example.com/a.png' }, 'again')).toEqual([])
  })
})
