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
