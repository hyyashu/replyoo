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
