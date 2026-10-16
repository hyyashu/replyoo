import type { Db } from '@replyooo/db'
import { contacts, flowRuns, jobOutbox, messages, webhookEvents } from '@replyooo/db'
import { MetaError } from '@replyooo/meta'
import type { FlowDefinition } from '@replyooo/shared'
import { Queue, Worker } from 'bullmq'
import { and, eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { describe, expect, inject, it } from 'vitest'
import type { FlowJobData } from '../src/deps'
import { handleFlowJob } from '../src/flow'
import { handleInbound } from '../src/inbound'
import { MAX_INBOUND_ATTEMPTS, sweep } from '../src/maintenance'
import { CLAIM_GRACE_MS, handleOutbound, MAX_SEND_ATTEMPTS, SEND_LEASE_MS } from '../src/outbound'
import { addOrRevive } from '../src/queues'
import { createTestContext, dm, insertEvent, insertRun, NOW, publishAutomation, seedAccount, seedContact } from './support'

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
const ago = (ms: number) => new Date(NOW.getTime() - ms)

async function setup() {
  const ctx = createTestContext()
  const db = ctx.deps.db
  const { account } = await seedAccount(db)
  const published = await publishAutomation(db, account, askFlow)
  const contact = await seedContact(db, account)
  const refs = { account, contact, ...published }
  const waiting = () =>
    insertRun(db, refs, {
      status: 'waiting',
      currentStepId: 'ask',
      wait: { kind: 'reply', attempts: 0 },
      waitUntil: new Date(NOW.getTime() + 86_400_000),
      stateVersion: 1,
    })
  const queue = async (values: Partial<typeof messages.$inferInsert> = {}) => {
    const [row] = await db
      .insert(messages)
      .values({
        contactId: contact.id,
        connectedAccountId: account.id,
        direction: 'out',
        kind: 'dm',
        body: { type: 'message', message: { text: 'hi' } },
        status: 'queued',
        ...values,
      })
      .returning()
    return row!
  }
  const reply = (text: string) => dm(account, contact.platformUserId, text)
  return { ...ctx, db, refs, waiting, queue, reply }
}

/** A db whose next `UPDATE ... SET status = 'sent'` fails, like a crash or lost connection right after Meta accepted. */
function failOnMarkSent(db: Db): Db {
  let failed = false
  return new Proxy(db, {
    get(target, key, receiver) {
      if (key !== 'update') return Reflect.get(target, key, receiver)
      return (table: Parameters<Db['update']>[0]) => {
        const builder = target.update(table)
        const set = builder.set.bind(builder)
        builder.set = ((values: { status?: string }) => {
          if (values.status === 'sent' && !failed) {
            failed = true
            throw new Error('connection lost')
          }
          return set(values as never)
        }) as typeof builder.set
        return builder
      }
    },
  })
}

async function statuses(db: Db, ids: string[]) {
  const rows = await db.select().from(messages).where(inArray(messages.id, ids))
  return ids.map((id) => {
    const row = rows.find((r) => r.id === id)
    return [row?.status, row?.error]
  })
}

describe('outbound claims', () => {
  it('a crash after Meta accepted does not resend on retry', async () => {
    const { db, deps, adapters, queue } = await setup()
    const message = await queue()
    await expect(handleOutbound({ ...deps, db: failOnMarkSent(db) }, { messageIds: [message.id] })).rejects.toThrow('connection lost')
    const [claimed] = await db.select().from(messages).where(eq(messages.id, message.id))
    expect(claimed).toMatchObject({ status: 'sending', attempts: 1 })

    expect(await handleOutbound(deps, { messageIds: [message.id] })).toEqual({
      status: 'wait_for_claim',
      retryInMs: SEND_LEASE_MS + CLAIM_GRACE_MS,
    })
    await handleOutbound(deps, { messageIds: [message.id] }, { isFinal: true })
    expect(adapters.instagram.sent('sendMessage')).toHaveLength(1)
  })

  it('the sweep fails a lapsed claim send_unknown, skips the rest of its run and resends nothing', async () => {
    const { db, deps, jobs, adapters, refs, queue } = await setup()
    const run = await insertRun(db, refs, { status: 'running', stateVersion: 1 })
    const lapsed = await queue({
      flowRunId: run.id,
      status: 'sending',
      claimedAt: ago(SEND_LEASE_MS + 60_000),
      attempts: 1,
      createdAt: ago(20 * 60_000),
    })
    const later = await queue({ flowRunId: run.id, createdAt: ago(19 * 60_000) })
    const result = await sweep(deps)
    expect(result.lapsed).toBe(1)
    expect(jobs.outbounds).toEqual([])
    expect(await statuses(db, [lapsed.id, later.id])).toEqual([
      ['failed', 'send_unknown'],
      ['failed', 'skipped'],
    ])
    const [runAfter] = await db.select().from(flowRuns).where(eq(flowRuns.id, run.id))
    expect(runAfter).toMatchObject({ status: 'failed', error: 'send_unknown' })
    expect(adapters.instagram.sent()).toEqual([])
  })

  it('a job finding a lapsed claim fails it send_unknown instead of resending', async () => {
    const { db, deps, adapters, refs, queue } = await setup()
    const run = await insertRun(db, refs, { status: 'running', stateVersion: 1 })
    const lapsed = await queue({ flowRunId: run.id, status: 'sending', claimedAt: ago(SEND_LEASE_MS + 60_000), attempts: 1 })
    const later = await queue({ flowRunId: run.id })
    const elsewhere = await queue({ flowRunId: run.id })
    expect(await handleOutbound(deps, { messageIds: [lapsed.id, later.id] })).toEqual({ status: 'done' })
    expect(await statuses(db, [lapsed.id, later.id, elsewhere.id])).toEqual([
      ['failed', 'send_unknown'],
      ['failed', 'skipped'],
      ['failed', 'skipped'],
    ])
    const [runAfter] = await db.select().from(flowRuns).where(eq(flowRuns.id, run.id))
    expect(runAfter).toMatchObject({ status: 'failed', error: 'send_unknown' })
    expect(adapters.instagram.sent()).toEqual([])
  })

  it('a send that times out fails delivery_unknown and skips the rest of the run, even before the final attempt', async () => {
    const { db, deps, adapters, refs, queue } = await setup()
    const run = await insertRun(db, refs, { status: 'running', stateVersion: 1 })
    const first = await queue({ flowRunId: run.id })
    const second = await queue({ flowRunId: run.id })
    const elsewhere = await queue({ flowRunId: run.id })
    adapters.instagram.errors.push(new MetaError('retryable', 'timed out', { reason: 'timeout_ambiguous' }))
    expect(await handleOutbound(deps, { messageIds: [first.id, second.id] })).toEqual({ status: 'done' })
    expect(await statuses(db, [first.id, second.id, elsewhere.id])).toEqual([
      ['failed', 'delivery_unknown'],
      ['failed', 'skipped'],
      ['failed', 'skipped'],
    ])
    const [runAfter] = await db.select().from(flowRuns).where(eq(flowRuns.id, run.id))
    expect(runAfter).toMatchObject({ status: 'failed', error: 'delivery_unknown' })
  })

  it('a job behind a live claim waits for it, then sends the rest once it is sent', async () => {
    const { db, deps, adapters, refs, queue } = await setup()
    const run = await insertRun(db, refs, { status: 'running', stateVersion: 1 })
    const a = await queue({ flowRunId: run.id, status: 'sending', claimedAt: ago(60_000), attempts: 1 })
    const b = await queue({ flowRunId: run.id })
    expect(await handleOutbound(deps, { messageIds: [a.id, b.id] })).toEqual({
      status: 'wait_for_claim',
      retryInMs: SEND_LEASE_MS - 60_000 + CLAIM_GRACE_MS,
    })
    expect(await statuses(db, [b.id])).toEqual([['queued', null]])

    await db.update(messages).set({ status: 'sent', claimedAt: null }).where(eq(messages.id, a.id))
    expect(await handleOutbound(deps, { messageIds: [a.id, b.id] })).toEqual({ status: 'done' })
    expect(await statuses(db, [a.id, b.id])).toEqual([
      ['sent', null],
      ['sent', null],
    ])
    expect(adapters.instagram.sent('sendMessage')).toHaveLength(1)
  })

  it('a job behind a claim that lapses fails it send_unknown and skips the rest', async () => {
    const { db, deps, clock, adapters, refs, queue } = await setup()
    const run = await insertRun(db, refs, { status: 'running', stateVersion: 1 })
    const a = await queue({ flowRunId: run.id, status: 'sending', claimedAt: ago(60_000), attempts: 1 })
    const b = await queue({ flowRunId: run.id })
    const waited = await handleOutbound(deps, { messageIds: [a.id, b.id] })
    expect(waited.status).toBe('wait_for_claim')

    clock.now = new Date(NOW.getTime() + (waited as { retryInMs: number }).retryInMs)
    expect(await handleOutbound(deps, { messageIds: [a.id, b.id] })).toEqual({ status: 'done' })
    expect(await statuses(db, [a.id, b.id])).toEqual([
      ['failed', 'send_unknown'],
      ['failed', 'skipped'],
    ])
    expect(adapters.instagram.sent()).toEqual([])
  })

  it('the sweep enqueues nothing for a run whose earlier message holds a live claim', async () => {
    const { db, deps, jobs, refs, queue } = await setup()
    const run = await insertRun(db, refs, { status: 'running', stateVersion: 1 })
    await queue({ flowRunId: run.id, status: 'sending', claimedAt: ago(60_000), attempts: 1, createdAt: ago(20 * 60_000) })
    await queue({ flowRunId: run.id, createdAt: ago(19 * 60_000) })
    await sweep(deps)
    expect(jobs.outbounds).toEqual([])
  })

  it('the sweep fails a message out of attempts instead of resending it', async () => {
    const { db, deps, jobs, refs, queue } = await setup()
    const run = await insertRun(db, refs, { status: 'running', stateVersion: 1 })
    const spent = await queue({
      flowRunId: run.id,
      attempts: MAX_SEND_ATTEMPTS,
      createdAt: ago(20 * 60_000),
    })
    await sweep(deps)
    expect(jobs.outbounds.flatMap((job) => job.messageIds)).not.toContain(spent.id)
    const [after] = await db.select().from(messages).where(eq(messages.id, spent.id))
    expect(after).toMatchObject({ status: 'failed', error: 'max_attempts' })
    const [runAfter] = await db.select().from(flowRuns).where(eq(flowRuns.id, run.id))
    expect(runAfter).toMatchObject({ status: 'failed', error: 'max_attempts' })
  })

  it('a non-Meta error on the last attempt fails the message and the run', async () => {
    const { db, deps, adapters, refs, queue } = await setup()
    const run = await insertRun(db, refs, { status: 'running', stateVersion: 1 })
    // A private reply without a comment id cannot be sent at all.
    const broken = await queue({ flowRunId: run.id, kind: 'private_reply', commentId: null })
    await expect(handleOutbound(deps, { messageIds: [broken.id] })).rejects.toThrow('no comment id')
    const [released] = await db.select().from(messages).where(eq(messages.id, broken.id))
    expect(released?.status).toBe('queued')

    await handleOutbound(deps, { messageIds: [broken.id] }, { isFinal: true })
    const [after] = await db.select().from(messages).where(eq(messages.id, broken.id))
    expect(after).toMatchObject({ status: 'failed', error: 'send_error' })
    const [runAfter] = await db.select().from(flowRuns).where(eq(flowRuns.id, run.id))
    expect(runAfter?.status).toBe('failed')
    expect(adapters.instagram.sent()).toEqual([])
  })
})

describe('resume jobs', () => {
  it('a duplicate resume job is applied once', async () => {
    const { db, deps, jobs, waiting, reply } = await setup()
    const run = await waiting()
    await handleInbound(deps, await insertEvent(db, reply('priya@gmail.com')))
    const [job] = jobs.flows
    expect(job?.data).toMatchObject({ runId: run.id, expectedVersion: 1 })
    expect(job?.opts?.jobId).toMatch(/^resume-/)

    await handleFlowJob(deps, job!.data)
    await handleFlowJob(deps, job!.data)
    const [after] = await db.select().from(flowRuns).where(eq(flowRuns.id, run.id))
    expect(after?.stateVersion).toBe(2)
  })

  it('ignores a resume whose expectedVersion is stale', async () => {
    const { db, deps, waiting } = await setup()
    const run = await waiting()
    await handleFlowJob(deps, { runId: run.id, event: { type: 'reply', text: 'priya@gmail.com' }, expectedVersion: 0 })
    const [after] = await db.select().from(flowRuns).where(eq(flowRuns.id, run.id))
    expect(after).toMatchObject({ status: 'waiting', stateVersion: 1 })
  })

  it('delays a timeout that arrives before the deadline without touching the run', async () => {
    const { db, deps, waiting } = await setup()
    const run = await waiting()
    const result = await handleFlowJob(deps, { runId: run.id, event: { type: 'timeout' }, expectedVersion: 1 })
    expect(result).toEqual({ status: 'early', retryAt: new Date(run.waitUntil!.getTime() + 1000) })
    const [after] = await db.select().from(flowRuns).where(eq(flowRuns.id, run.id))
    expect(after).toMatchObject({ status: 'waiting', stateVersion: 1, error: null })
  })

  it('fails a waiting run whose current timeout it cannot take', async () => {
    const { db, deps, refs } = await setup()
    const run = await insertRun(db, refs, { status: 'waiting', wait: { kind: 'postback' }, stateVersion: 3 })
    await handleFlowJob(deps, { runId: run.id, event: { type: 'timeout' }, expectedVersion: 3 })
    const [after] = await db.select().from(flowRuns).where(eq(flowRuns.id, run.id))
    expect(after).toMatchObject({ status: 'failed', error: 'timeout_ignored' })
  })
})

describe('job outbox', () => {
  it('a lost enqueue after commit is replayed by the sweep', async () => {
    const { db, deps, jobs, waiting, reply } = await setup()
    const run = await waiting()
    const flow = jobs.flow.bind(jobs)
    let down = true
    jobs.flow = async (data: FlowJobData, opts) => {
      if (down) throw new Error('redis down')
      return flow(data, opts)
    }
    const eventId = await insertEvent(db, reply('priya@gmail.com'))
    await handleInbound(deps, eventId)
    const [event] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, eventId))
    expect(event?.processedAt).not.toBeNull()
    const [pending] = await db.select().from(jobOutbox).where(eq(jobOutbox.jobId, `resume-${eventId}`))
    expect(pending?.enqueuedAt).toBeNull()
    expect(jobs.flows).toEqual([])

    down = false
    await db.update(jobOutbox).set({ createdAt: ago(60_000) }).where(eq(jobOutbox.id, pending!.id))
    await sweep(deps)
    // The sweep can also replay pending rows left by other tests sharing the database.
    expect(jobs.flows.filter((j) => j.opts?.jobId === `resume-${eventId}`)).toEqual([
      { data: { runId: run.id, event: { type: 'reply', text: 'priya@gmail.com' }, expectedVersion: 1 }, opts: { jobId: `resume-${eventId}` } },
    ])
    const [replayed] = await db.select().from(jobOutbox).where(eq(jobOutbox.id, pending!.id))
    expect(replayed?.enqueuedAt).not.toBeNull()
  })

  it('flow post-commit jobs go through the outbox with deterministic ids', async () => {
    const { db, deps, jobs, refs } = await setup()
    const run = await insertRun(db, refs)
    await handleFlowJob(deps, { runId: run.id, event: { type: 'start', trigger: { kind: 'dm', text: 'guide' } }, expectedVersion: 0 })
    const rows = await db.select().from(jobOutbox).where(inArray(jobOutbox.jobId, [`timeout-${run.id}-1`]))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.enqueuedAt).not.toBeNull()
    const [question] = await db.select().from(messages).where(eq(messages.flowRunId, run.id))
    expect(jobs.outbounds).toEqual([{ messageIds: [question!.id] }])
    expect(jobs.flows.map((j) => j.opts?.jobId)).toEqual([`timeout-${run.id}-1`])
  })
})

describe('per-contact serialisation', () => {
  it('two DMs racing for one waiting question are answered once', async () => {
    const { db, deps, jobs, waiting, reply, refs } = await setup()
    const run = await waiting()
    await Promise.all([
      handleInbound(deps, await insertEvent(db, reply('a@example.com'))),
      handleInbound(deps, await insertEvent(db, reply('b@example.com'))),
    ])
    expect(jobs.flows).toHaveLength(2)
    await Promise.all(jobs.flows.map((job) => handleFlowJob(deps, job.data)))
    const [after] = await db.select().from(flowRuns).where(eq(flowRuns.id, run.id))
    expect(after?.stateVersion).toBe(2)
    const [saved] = await db.select().from(contacts).where(eq(contacts.id, refs.contact.id))
    expect(['a@example.com', 'b@example.com']).toContain(saved?.email)
  })

  it('two keyword DMs from a new contact start one run', async () => {
    const { db, deps, refs } = await setup()
    const sender = `new_${randomUUID()}`
    await Promise.all([
      handleInbound(deps, await insertEvent(db, dm(refs.account, sender, 'guide please'))),
      handleInbound(deps, await insertEvent(db, dm(refs.account, sender, 'the guide'))),
    ])
    const [contact] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.connectedAccountId, refs.account.id), eq(contacts.platformUserId, sender)))
    const runs = await db.select().from(flowRuns).where(eq(flowRuns.contactId, contact!.id))
    expect(runs).toHaveLength(1)
  })
})

describe('inbound retry cap', () => {
  it('counts failed attempts and the sweep stops replaying an event at the cap', async () => {
    const { db, deps, jobs, reply } = await setup()
    const id = await insertEvent(db, reply('hi'))
    await db.update(webhookEvents).set({ receivedAt: ago(10 * 60_000) }).where(eq(webhookEvents.id, id))
    const broken = { ...deps, db: failTransactions(db) }
    await expect(handleInbound(broken, id)).rejects.toThrow('db down')
    await expect(handleInbound(broken, id)).rejects.toThrow('db down')
    const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, id))
    expect(row).toMatchObject({ attempts: 2, error: 'db down', processedAt: null })

    await sweep(deps)
    expect(jobs.inbounds).toContain(id)
    jobs.inbounds.length = 0
    await db.update(webhookEvents).set({ attempts: MAX_INBOUND_ATTEMPTS }).where(eq(webhookEvents.id, id))
    await sweep(deps)
    expect(jobs.inbounds).not.toContain(id)
  })
})

/** A db whose transactions all fail, like a database that keeps rejecting the event's writes. */
function failTransactions(db: Db): Db {
  return new Proxy(db, {
    get(target, key, receiver) {
      if (key === 'transaction') return async () => Promise.reject(new Error('db down'))
      return Reflect.get(target, key, receiver)
    },
  })
}

describe('addOrRevive', () => {
  it('retries a job that already failed under the same id', async () => {
    const connection = { url: inject('redisUrl') }
    const prefix = `revive-${randomUUID()}`
    const queue = new Queue('t', { connection, prefix })
    let calls = 0
    const worker = new Worker(
      't',
      async () => {
        calls++
        if (calls === 1) throw new Error('boom')
      },
      { connection: { ...connection, maxRetriesPerRequest: null }, prefix },
    )
    try {
      await queue.add('t', {}, { jobId: 'job-1', attempts: 1, removeOnFail: false })
      await until(async () => (await queue.getJob('job-1'))?.isFailed())
      await queue.add('t', {}, { jobId: 'job-1' })
      expect(await (await queue.getJob('job-1'))?.getState()).toBe('failed')

      await addOrRevive(queue, 't', {}, { jobId: 'job-1' })
      await until(async () => (await queue.getJob('job-1'))?.isCompleted())
      expect(calls).toBe(2)
    } finally {
      await worker.close()
      await queue.obliterate({ force: true })
      await queue.close()
    }
  })
})

describe('addOrRevive attempts', () => {
  it('gives a revived job fresh attempts', async () => {
    const connection = { url: inject('redisUrl') }
    const prefix = `revive-${randomUUID()}`
    const queue = new Queue('t', { connection, prefix })
    let calls = 0
    const worker = new Worker(
      't',
      async () => {
        calls++
        // Fails both original attempts and the revived job's first one; only fresh attempts reach a fourth call.
        if (calls <= 3) throw new Error('boom')
      },
      { connection: { ...connection, maxRetriesPerRequest: null }, prefix },
    )
    try {
      await queue.add('t', {}, { jobId: 'job-1', attempts: 2, removeOnFail: false })
      await until(async () => (await queue.getJob('job-1'))?.isFailed())
      expect((await queue.getJob('job-1'))?.attemptsMade).toBe(2)

      await addOrRevive(queue, 't', {}, { jobId: 'job-1' })
      await until(async () => (await queue.getJob('job-1'))?.isCompleted())
      expect(calls).toBe(4)
    } finally {
      await worker.close()
      await queue.obliterate({ force: true })
      await queue.close()
    }
  })
})

async function until(check: () => Promise<boolean | undefined>, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('timed out')
}
