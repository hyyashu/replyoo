import { DelayedError, type Job, type JobsOptions, Queue, Worker } from 'bullmq'
import type { Deps, FlowJobData, FollowCheckJobData, Jobs, OutboundJobData } from './deps'
import { handleFlowJob, handleFollowCheck } from './flow'
import { handleBackfill } from './backfill'
import { handleInbound } from './inbound'
import { pruneWebhookEvents, refreshAccountProfiles, refreshExpiringTokens, sweep } from './maintenance'
import { handleOutbound } from './outbound'

export type QueueName = 'inbound' | 'flow' | 'outbound' | 'maintenance' | 'backfill'
export type Queues = Record<QueueName, Queue>

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
}

export function createQueues(redisUrl: string, prefix?: string): Queues {
  const options = { connection: { url: redisUrl }, defaultJobOptions, ...(prefix ? { prefix } : {}) }
  return {
    inbound: new Queue('inbound', options),
    flow: new Queue('flow', options),
    outbound: new Queue('outbound', options),
    maintenance: new Queue('maintenance', { ...options, defaultJobOptions: { ...defaultJobOptions, attempts: 1 } }),
    backfill: new Queue('backfill', { ...options, defaultJobOptions: { ...defaultJobOptions, attempts: 1 } }),
  }
}

export async function closeQueues(queues: Queues): Promise<void> {
  await Promise.all(Object.values(queues).map((queue) => queue.close()))
}

/**
 * Adds a job, or revives the one already holding its id. BullMQ ignores an add whose id exists, and failed and
 * completed jobs are kept for a while, so a plain re-add (the sweep's, or an outbox replay) would be a no-op:
 * a failed job is retried instead, a completed one is replaced. Waiting, delayed and active jobs are left alone.
 * Handlers are idempotent (claims, expectedVersion, processedAt), so a revived job never applies work twice.
 */
export async function addOrRevive(queue: Queue, name: string, data: unknown, opts: JobsOptions & { jobId: string }): Promise<void> {
  const existing = await queue.getJob(opts.jobId)
  if (existing) {
    const state = await existing.getState()
    if (state === 'failed') {
      // Fresh attempts: a revived job that fails once must not be final straight away. It may race a cleanup.
      await existing.retry('failed', { resetAttemptsMade: true, resetAttemptsStarted: true }).catch(() => undefined)
      return
    }
    if (state !== 'completed') return
    await existing.remove().catch(() => undefined)
  }
  await queue.add(name, data, opts)
}

export function createBullJobs(queues: Queues): Jobs {
  return {
    async inbound(webhookEventId) {
      await addOrRevive(queues.inbound, 'inbound', { webhookEventId }, { jobId: `inbound-${webhookEventId}` })
    },
    async inboundMany(webhookEventIds) {
      if (webhookEventIds.length === 0) return
      await queues.inbound.addBulk(
        webhookEventIds.map((webhookEventId) => ({ name: 'inbound', data: { webhookEventId }, opts: { jobId: `inbound-${webhookEventId}` } })),
      )
    },
    async flow(data, opts) {
      const delay = opts?.at ? { delay: Math.max(0, opts.at.getTime() - Date.now()) } : {}
      if (opts?.jobId) await addOrRevive(queues.flow, 'advance', data, { ...delay, jobId: opts.jobId })
      else await queues.flow.add('advance', data, delay)
    },
    async followCheck(data, opts) {
      if (opts?.jobId) await addOrRevive(queues.flow, 'follow_check', data, { jobId: opts.jobId })
      else await queues.flow.add('follow_check', data)
    },
    async outbound(data) {
      const first = data.messageIds[0]
      if (!first) return
      await addOrRevive(queues.outbound, 'send', data, { jobId: `out-${first}` })
    },
    async backfill(runId) {
      await addOrRevive(queues.backfill, 'backfill', { runId }, { jobId: `backfill-${runId}` })
    },
  }
}

export function startWorkers(
  deps: Deps,
  redisUrl: string,
  opts: { prefix?: string; concurrency?: number } = {},
): Worker[] {
  const base = {
    connection: { url: redisUrl, maxRetriesPerRequest: null },
    concurrency: opts.concurrency ?? 10,
    ...(opts.prefix ? { prefix: opts.prefix } : {}),
  }

  const workers = [
    new Worker(
      'inbound',
      async (job: Job<{ webhookEventId: string }>, token?: string) => {
        const result = await handleInbound(deps, job.data.webhookEventId)
        if (result.status === 'deferred') {
          await job.moveToDelayed(Date.now() + result.retryInMs, token)
          throw new DelayedError()
        }
      },
      base,
    ),
    new Worker(
      'flow',
      async (job: Job<FlowJobData | FollowCheckJobData>, token?: string) => {
        if (job.name === 'follow_check') {
          await handleFollowCheck(deps, job.data as FollowCheckJobData)
          return
        }
        const result = await handleFlowJob(deps, job.data as FlowJobData)
        if (result.status === 'early') {
          await job.moveToDelayed(Math.max(result.retryAt.getTime(), Date.now() + 1000), token)
          throw new DelayedError()
        }
      },
      base,
    ),
    new Worker(
      'outbound',
      async (job: Job<OutboundJobData>, token?: string) => {
        const isFinal = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)
        const result = await handleOutbound(deps, job.data, { isFinal })
        if (result.status !== 'done') {
          await job.moveToDelayed(Date.now() + result.retryInMs, token)
          throw new DelayedError()
        }
      },
      base,
    ),
    new Worker(
      'maintenance',
      async (job: Job) => {
        switch (job.name) {
          case 'sweep':
            return sweep(deps)
          case 'refresh-tokens':
            return refreshExpiringTokens(deps)
          case 'refresh-profiles':
            return refreshAccountProfiles(deps)
          case 'prune-webhooks':
            return pruneWebhookEvents(deps)
        }
      },
      { ...base, concurrency: 1 },
    ),
    new Worker('backfill', async (job: Job<{ runId: string }>) => handleBackfill(deps, job.data.runId), { ...base, concurrency: 1 }),
  ]
  for (const worker of workers) {
    worker.on('failed', (job, err) =>
      deps.log.error({ err, queue: worker.name, jobId: job?.id, attempts: job?.attemptsMade }, 'job failed'),
    )
  }
  return workers
}

export async function scheduleMaintenance(queues: Queues): Promise<void> {
  await queues.maintenance.upsertJobScheduler('sweep', { every: 60_000 }, { name: 'sweep' })
  await queues.maintenance.upsertJobScheduler('refresh-tokens', { pattern: '0 3 * * *' }, { name: 'refresh-tokens' })
  await queues.maintenance.upsertJobScheduler('refresh-profiles', { pattern: '15 */6 * * *' }, { name: 'refresh-profiles' })
  await queues.maintenance.upsertJobScheduler('prune-webhooks', { pattern: '30 3 * * *' }, { name: 'prune-webhooks' })
}
