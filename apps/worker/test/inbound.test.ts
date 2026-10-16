import type { NormalizedEvent } from '@replyooo/meta'
import { MetaError } from '@replyooo/meta'
import { automationEntries, automations, connectedAccounts, contacts, flowRuns, messages, usageCounters, webhookEvents } from '@replyooo/db'
import type { FlowDefinition } from '@replyooo/shared'
import { encodePostback, PLAN_LIMITS, usagePeriod } from '@replyooo/shared'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { handleInbound, PROFILE_RETRY_MS, PROFILE_TTL_MS } from '../src/inbound'
import {
  allowAll,
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
  seedUsage,
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

  it('lets only the restricted automation answer a re-run comment', async () => {
    const { db, deps, jobs, account } = await setup()
    const older = await publishAutomation(db, account, commentFlow(), { publishedAt: new Date(NOW.getTime() - 2 * 86_400_000) })
    await publishAutomation(db, account, commentFlow(), { publishedAt: NOW })
    const event = { ...comment(account, 'u1', 'send the guide'), restrictToAutomationId: older.automation.id } as NormalizedEvent
    await handleInbound(deps, await insertEvent(db, event))
    expect(jobs.flows).toHaveLength(1)
    const runs = await db.select().from(flowRuns)
    expect(runs.filter((r) => r.automationId === older.automation.id)).toHaveLength(1)
    expect(runs.filter((r) => r.automationId !== older.automation.id && r.connectedAccountId === account.id)).toHaveLength(0)
  })

  it('does not let a re-run comment cancel a conversation the person is in the middle of', async () => {
    const { db, deps, jobs, account } = await setup()
    const rerun = await publishAutomation(db, account, commentFlow())
    const other = await publishAutomation(db, account, askFlow)
    const contact = await seedContact(db, account, { platformUserId: 'u1' })
    const waiting = await insertRun(
      db,
      { account, contact, automation: other.automation, version: other.version },
      { status: 'waiting', wait: { kind: 'reply', attempts: 0 }, stateVersion: 1 },
    )
    const event = { ...comment(account, 'u1', 'send the guide'), restrictToAutomationId: rerun.automation.id } as NormalizedEvent
    await handleInbound(deps, await insertEvent(db, event))
    expect(jobs.flows).toEqual([])
    const [after] = await db.select().from(flowRuns).where(eq(flowRuns.id, waiting.id))
    expect(after?.status).toBe('waiting')
    const started = await db.select().from(flowRuns).where(eq(flowRuns.automationId, rerun.automation.id))
    expect(started).toEqual([])
  })

  it('ignores a restricted re-run comment when its automation is no longer active', async () => {
    const { db, deps, jobs, account } = await setup()
    const only = await publishAutomation(db, account, commentFlow())
    await publishAutomation(db, account, commentFlow(), { publishedAt: new Date(NOW.getTime() + 1000) })
    await db.update(automations).set({ status: 'paused' }).where(eq(automations.id, only.automation.id))
    const event = { ...comment(account, 'u1', 'guide'), restrictToAutomationId: only.automation.id } as NormalizedEvent
    await handleInbound(deps, await insertEvent(db, event))
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
      {
        data: { runId: run!.id, event: { type: 'start', trigger: { kind: 'dm', text: 'PRICE?' } }, expectedVersion: 0 },
        opts: { jobId: `start-${run!.id}` },
      },
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
    expect(jobs.flows).toEqual([
      {
        data: { runId: run.id, event: { type: 'reply', text: 'priya@gmail.com' }, expectedVersion: 1 },
        opts: { jobId: expect.stringMatching(/^resume-/) },
      },
    ])
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
      {
        data: { runId: run.id, event: { type: 'postback', stepId: 's1', buttonId: 'b1' }, expectedVersion: run.stateVersion },
        opts: { jobId: expect.stringMatching(/^resume-/) },
      },
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

describe('plan limits', () => {
  const FREE_LIMIT = PLAN_LIMITS.free.contactsPerMonth

  it('starts no run for a new contact once the month’s contacts are used up', async () => {
    const { db, deps, jobs, account } = await setup()
    const { automation } = await publishAutomation(db, account, keywordFlow)
    await seedUsage(db, account.workspaceId, FREE_LIMIT)

    await handleInbound(deps, await insertEvent(db, dm(account, 'u-new', 'price please')))
    expect(jobs.flows).toEqual([])
    // The cooldown wasn't consumed, so the contact gets a run as soon as there's room again.
    expect(await db.select().from(automationEntries).where(eq(automationEntries.automationId, automation.id))).toEqual([])
    // The inbound message is still logged.
    expect(await db.select().from(messages).where(eq(messages.connectedAccountId, account.id))).toHaveLength(1)
  })

  it('keeps serving a contact already counted this month', async () => {
    const { db, deps, jobs, account } = await setup()
    await publishAutomation(db, account, keywordFlow)
    await seedContact(db, account, { platformUserId: 'u-known', lastCountedPeriod: usagePeriod(NOW) })
    await seedUsage(db, account.workspaceId, FREE_LIMIT)

    await handleInbound(deps, await insertEvent(db, dm(account, 'u-known', 'price please')))
    expect(jobs.flows).toHaveLength(1)
  })

  it('uses the paid plan’s limit while the subscription is active', async () => {
    const { db, deps, jobs, account } = await setup()
    await publishAutomation(db, account, keywordFlow)
    await seedUsage(db, account.workspaceId, FREE_LIMIT, { plan: 'pro' })

    await handleInbound(deps, await insertEvent(db, dm(account, 'u-pro', 'price please')))
    expect(jobs.flows).toHaveLength(1)
  })

  it('falls back to the free limit when the paid subscription is on hold', async () => {
    const { db, deps, jobs, account } = await setup()
    await publishAutomation(db, account, keywordFlow)
    await seedUsage(db, account.workspaceId, FREE_LIMIT, { plan: 'pro', status: 'on_hold' })

    await handleInbound(deps, await insertEvent(db, dm(account, 'u-hold', 'price please')))
    expect(jobs.flows).toEqual([])
  })

  it('lets concurrent new contacts start no more runs than the month has room for', async () => {
    const { db, deps, jobs, account } = await setup()
    await publishAutomation(db, account, keywordFlow)
    await seedUsage(db, account.workspaceId, FREE_LIMIT - 2)

    const ids = await Promise.all(Array.from({ length: 6 }, (_, i) => insertEvent(db, dm(account, `u-rush-${i}`, 'price please'))))
    await Promise.all(ids.map((id) => handleInbound(deps, id)))
    expect(jobs.flows).toHaveLength(2)
    const [usage] = await db.select().from(usageCounters).where(eq(usageCounters.workspaceId, account.workspaceId))
    expect(usage?.contactsReached).toBe(FREE_LIMIT)
    const counted = await db.select().from(contacts).where(eq(contacts.lastCountedPeriod, usagePeriod(NOW)))
    expect(counted.filter((c) => c.connectedAccountId === account.id)).toHaveLength(2)
  })

  it('counts a contact once when it starts several runs in a month', async () => {
    const { db, deps, account } = await setup()
    await publishAutomation(db, account, keywordFlow)
    await publishAutomation(db, account, anyDmFlow)
    await seedUsage(db, account.workspaceId, 0)
    await handleInbound(deps, await insertEvent(db, dm(account, 'u-twice', 'price please')))
    await handleInbound(deps, await insertEvent(db, dm(account, 'u-twice', 'hello again')))
    const [usage] = await db.select().from(usageCounters).where(eq(usageCounters.workspaceId, account.workspaceId))
    expect(usage?.contactsReached).toBe(1)
  })

  it('lets a waiting run finish at the limit', async () => {
    const { db, deps, jobs, account } = await setup()
    const ask = await publishAutomation(db, account, askFlow)
    const contact = await seedContact(db, account, { platformUserId: 'u-waiting' })
    const run = await insertRun(db, { account, contact, ...ask }, {
      status: 'waiting',
      currentStepId: 'ask',
      wait: { kind: 'reply', attempts: 0 },
      waitUntil: new Date(NOW.getTime() + 86_400_000),
      stateVersion: 1,
    })
    await seedUsage(db, account.workspaceId, FREE_LIMIT)

    await handleInbound(deps, await insertEvent(db, dm(account, 'u-waiting', 'priya@gmail.com')))
    expect(jobs.flows).toEqual([
      {
        data: { runId: run.id, event: { type: 'reply', text: 'priya@gmail.com' }, expectedVersion: 1 },
        opts: { jobId: expect.stringMatching(/^resume-/) },
      },
    ])
  })
})

describe('inbound Graph lookups', () => {
  const nextPost = async () => {
    const ctx = await setup()
    await publishAutomation(ctx.db, ctx.account, commentFlow({ mode: 'next' }), { publishedAt: new Date(NOW.getTime() - 3_600_000) })
    return ctx
  }
  const accountStatus = async (db: Awaited<ReturnType<typeof setup>>['db'], id: string) =>
    (await db.select().from(connectedAccounts).where(eq(connectedAccounts.id, id)))[0]?.status

  it('retries the event when the post time lookup fails transiently', async () => {
    const { db, deps, jobs, adapters, account } = await nextPost()
    adapters.instagram.mediaError = new MetaError('retryable', 'graph down', { reason: 'server' })
    const id = await insertEvent(db, comment(account, 'u3', 'guide', { mediaId: 'new-post' }))
    await expect(handleInbound(deps, id)).rejects.toThrow('graph down')
    const [event] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, id))
    expect(event).toMatchObject({ processedAt: null, error: 'graph down' })
    expect(jobs.flows).toEqual([])
  })

  it('routes without the post time when Meta will not return the post', async () => {
    const { db, deps, adapters, account } = await nextPost()
    adapters.instagram.mediaError = new MetaError('permanent', 'not found', { reason: 'invalid_request' })
    const id = await insertEvent(db, comment(account, 'u3', 'guide', { mediaId: 'gone' }))
    await handleInbound(deps, id)
    const [event] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, id))
    expect(event?.processedAt).toEqual(NOW)
    expect(await accountStatus(db, account.id)).toBe('active')
  })

  it('flags the account when the post or profile lookup says the token is dead', async () => {
    const media = await nextPost()
    media.adapters.instagram.mediaError = new MetaError('reauth', 'expired', { reason: 'token_invalid' })
    await handleInbound(media.deps, await insertEvent(media.db, comment(media.account, 'u3', 'guide', { mediaId: 'p' })))
    expect(await accountStatus(media.db, media.account.id)).toBe('reauth_required')

    const profile = await setup()
    profile.adapters.instagram.profileError = new MetaError('reauth', 'expired', { reason: 'token_invalid' })
    const id = await insertEvent(profile.db, dm(profile.account, 'u1', 'hi'))
    await handleInbound(profile.deps, id)
    expect(await accountStatus(profile.db, profile.account.id)).toBe('reauth_required')
    const [contact] = await profile.db.select().from(contacts).where(eq(contacts.connectedAccountId, profile.account.id))
    expect(contact).toMatchObject({ platformUserId: 'u1', name: null })
  })

  it('refreshes a stale Instagram profile and follow state, and leaves a fresh one alone', async () => {
    const { db, deps, adapters, account } = await setup()
    const checked = new Date(NOW.getTime() - PROFILE_TTL_MS - 60_000)
    const stale = await seedContact(db, account, { platformUserId: 'u-stale', followsYou: false, followCheckedAt: checked })
    const fresh = await seedContact(db, account, { platformUserId: 'u-fresh', followsYou: false, followCheckedAt: NOW })
    adapters.instagram.profile = { name: 'Priya Sharma', username: 'priya', avatarUrl: 'https://cdn.example/p.jpg', followsYou: true, youFollow: false }

    await handleInbound(deps, await insertEvent(db, dm(account, 'u-stale', 'hi')))
    await handleInbound(deps, await insertEvent(db, dm(account, 'u-fresh', 'hi')))
    expect(adapters.instagram.sent('getProfile').map((c) => c.args[0])).toEqual(['u-stale'])

    const rows = await db.select().from(contacts).where(eq(contacts.connectedAccountId, account.id))
    expect(rows.find((r) => r.id === stale.id)).toMatchObject({ followsYou: true, youFollow: false, followCheckedAt: NOW, avatarUrl: 'https://cdn.example/p.jpg' })
    expect(rows.find((r) => r.id === fresh.id)).toMatchObject({ followsYou: false, followCheckedAt: NOW })
  })

  it('retries a failed profile lookup an hour later, not on every event', async () => {
    const { db, deps, adapters, account, clock } = await setup()
    const profileCalls = () => adapters.instagram.sent('getProfile').length
    adapters.instagram.profileError = new MetaError('retryable', 'graph down', { reason: 'server' })
    await handleInbound(deps, await insertEvent(db, dm(account, 'u1', 'hi')))
    expect(profileCalls()).toBe(1)

    await handleInbound(deps, await insertEvent(db, dm(account, 'u1', 'again')))
    expect(profileCalls()).toBe(1)

    clock.now = new Date(NOW.getTime() + PROFILE_RETRY_MS + 60_000)
    await handleInbound(deps, await insertEvent(db, dm(account, 'u1', 'later')))
    expect(profileCalls()).toBe(2)
    const [contact] = await db.select().from(contacts).where(eq(contacts.connectedAccountId, account.id))
    expect(contact).toMatchObject({ name: 'Priya Sharma', followCheckedAt: clock.now })
  })

  it('skips the profile lookup while the account is paused, stamping nothing', async () => {
    const { db, deps, adapters, account } = await setup()
    deps.rateLimiter = { ...allowAll, pausedMs: async () => 30_000 }
    const id = await insertEvent(db, dm(account, 'u1', 'hi'))
    expect(await handleInbound(deps, id)).toEqual({ status: 'done' })
    expect(adapters.instagram.sent('getProfile')).toEqual([])
    const [contact] = await db.select().from(contacts).where(eq(contacts.connectedAccountId, account.id))
    expect(contact).toMatchObject({ platformUserId: 'u1', followCheckedAt: null })
  })

  it('pauses the account when the profile lookup is rate limited', async () => {
    const { db, deps, adapters, account } = await setup()
    const pauses: [string, number][] = []
    deps.rateLimiter = { ...allowAll, pause: async (key, ms) => void pauses.push([key, ms]) }
    adapters.instagram.profileError = new MetaError('retryable', 'slow down', { reason: 'rate_limited', retryAfterMs: 90_000 })
    const id = await insertEvent(db, dm(account, 'u1', 'hi'))
    expect(await handleInbound(deps, id)).toEqual({ status: 'done' })
    expect(pauses).toEqual([[account.id, 90_000]])
  })

  it('defers the event without an error or attempt when the post time lookup is rate limited', async () => {
    const { db, deps, jobs, adapters, account } = await nextPost()
    const pauses: [string, number][] = []
    deps.rateLimiter = { ...allowAll, pause: async (key, ms) => void pauses.push([key, ms]) }
    adapters.instagram.mediaError = new MetaError('retryable', 'slow down', { reason: 'rate_limited', retryAfterMs: 60_000 })
    const id = await insertEvent(db, comment(account, 'u3', 'guide', { mediaId: 'new-post' }))
    expect(await handleInbound(deps, id)).toEqual({ status: 'deferred', retryInMs: 60_000 })
    expect(pauses).toEqual([[account.id, 60_000]])
    const [event] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, id))
    expect(event).toMatchObject({ processedAt: null, error: null, attempts: 0 })
    expect(jobs.flows).toEqual([])
  })

  it('defers the event without calling Graph while the account is paused', async () => {
    const { db, deps, adapters, account } = await nextPost()
    deps.rateLimiter = { ...allowAll, pausedMs: async () => 45_000 }
    const id = await insertEvent(db, comment(account, 'u3', 'guide', { mediaId: 'new-post' }))
    expect(await handleInbound(deps, id)).toEqual({ status: 'deferred', retryInMs: 45_000 })
    expect(adapters.instagram.sent('getMediaPublishedAt')).toEqual([])
    const [event] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, id))
    expect(event).toMatchObject({ processedAt: null, error: null, attempts: 0 })
  })
})
