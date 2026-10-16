import type { Db } from '@replyooo/db'
import { contacts, flowRuns, jobOutbox, messages, webhookEvents } from '@replyooo/db'
import type { FlowDefinition } from '@replyooo/shared'
import { Queue, Worker } from 'bullmq'
import { and, eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { describe, expect, inject, it } from 'vitest'
import type { FlowJobData } from '../src/deps'
import { handleFlowJob } from '../src/flow'
import { handleInbound } from '../src/inbound'
import { sweep } from '../src/maintenance'
import { handleOutbound, MAX_SEND_ATTEMPTS, SEND_LEASE_MS } from '../src/outbound'
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

describe('outbound claims', () => {
  it('a crash after Meta accepted does not resend on retry', async () => {
    const { db, deps, adapters, queue } = await setup()
    const message = await queue()
    await expect(handleOutbound({ ...deps, db: failOnMarkSent(db) }, { messageIds: [message.id] })).rejects.toThrow('connection lost')
    const [claimed] = await db.select().from(messages).where(eq(messages.id, message.id))
    expect(claimed).toMatchObject({ status: 'sending', attempts: 1 })

    await handleOutbound(deps, { messageIds: [message.id] })
    await handleOutbound(deps, { messageIds: [message.id] }, { isFinal: true })
    expect(adapters.instagram.sent('sendMessage')).toHaveLength(1)
  })

  it('the sweep leaves a live claim alone and retakes a lapsed one', async () => {
    const { db, deps, jobs, adapters, queue } = await setup()
    const live = await queue({ status: 'sending', claimedAt: ago(60_000), attempts: 1, createdAt: ago(20 * 60_000) })
    const lapsed = await queue({ status: 'sending', claimedAt: ago(SEND_LEASE_MS + 60_000), attempts: 1, createdAt: ago(20 * 60_000) })
    await sweep(deps)
    const swept = jobs.outbounds.flatMap((job) => job.messageIds)
    expect(swept).not.toContain(live.id)
    expect(swept).toContain(lapsed.id)

    await handleOutbound(deps, { messageIds: [live.id] })
    expect(adapters.instagram.sent('sendMessage')).toHaveLength(0)
  })

  it('the sweep fails a message out of attempts instead of resending it', async () => {
    const { db, deps, jobs, refs, queue } = await setup()
    const run = await insertRun(db, refs, { status: 'running', stateVersion: 1 })
    const spent = await queue({
      flowRunId: run.id,
      status: 'sending',
      claimedAt: ago(SEND_LEASE_MS + 60_000),
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
    expect(jobs.flows).toEqual([
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

async function until(check: () => Promise<boolean | undefined>, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('timed out')
}
