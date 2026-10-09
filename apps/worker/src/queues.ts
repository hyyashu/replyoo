import { DelayedError, type Job, type JobsOptions, Queue, Worker } from 'bullmq'
import type { Deps, FlowJobData, FollowCheckJobData, Jobs, OutboundJobData } from './deps'
import { handleFlowJob, handleFollowCheck } from './flow'
import { handleInbound } from './inbound'
import { pruneWebhookEvents, refreshAccountProfiles, refreshExpiringTokens, sweep } from './maintenance'
import { handleOutbound } from './outbound'

export type QueueName = 'inbound' | 'flow' | 'outbound' | 'maintenance'
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
  }
}

export async function closeQueues(queues: Queues): Promise<void> {
  await Promise.all(Object.values(queues).map((queue) => queue.close()))
}

export function createBullJobs(queues: Queues): Jobs {
  return {
    async inbound(webhookEventId) {
      await queues.inbound.add('inbound', { webhookEventId }, { jobId: `inbound-${webhookEventId}` })
    },
    async flow(data, opts) {
      await queues.flow.add('advance', data, {
        ...(opts?.at ? { delay: Math.max(0, opts.at.getTime() - Date.now()) } : {}),
        ...(opts?.jobId ? { jobId: opts.jobId } : {}),
      })
    },
    async followCheck(data) {
      await queues.flow.add('follow_check', data)
    },
    async outbound(data) {
      await queues.outbound.add('send', data)
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
    new Worker('inbound', async (job: Job<{ webhookEventId: string }>) => handleInbound(deps, job.data.webhookEventId), base),
    new Worker(
      'flow',
      async (job: Job<FlowJobData | FollowCheckJobData>) => {
        if (job.name === 'follow_check') await handleFollowCheck(deps, job.data as FollowCheckJobData)
        else await handleFlowJob(deps, job.data as FlowJobData)
      },
      base,
    ),
    new Worker(
      'outbound',
      async (job: Job<OutboundJobData>, token?: string) => {
        const isFinal = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)
        const result = await handleOutbound(deps, job.data, { isFinal })
        if (result.status === 'rate_limited') {
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
