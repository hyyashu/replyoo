import type { Tx } from '@replyooo/db'
import { jobOutbox } from '@replyooo/db'
import { and, asc, eq, inArray, isNull, lt } from 'drizzle-orm'
import type { Deps, FlowJobData, FollowCheckJobData, OutboundJobData } from './deps'

/** A job written in the same transaction as the state it acts on. `jobId` makes replays idempotent. */
export type OutboxJob =
  | { kind: 'flow'; jobId: string; data: FlowJobData; at?: Date }
  | { kind: 'follow_check'; jobId: string; data: FollowCheckJobData }
  | { kind: 'outbound'; jobId: string; data: OutboundJobData }

type OutboxRow = typeof jobOutbox.$inferSelect

const QUEUE: Record<OutboxJob['kind'], { queue: string; name: string }> = {
  flow: { queue: 'flow', name: 'advance' },
  follow_check: { queue: 'flow', name: 'follow_check' },
  outbound: { queue: 'outbound', name: 'send' },
}

/** Stages jobs inside `tx`. Returns the row ids to hand to `flushOutbox` once the transaction has committed. */
export async function stageJobs(tx: Tx, jobs: readonly OutboxJob[]): Promise<string[]> {
  if (jobs.length === 0) return []
  const rows = await tx
    .insert(jobOutbox)
    .values(
      jobs.map((job) => ({
        ...QUEUE[job.kind],
        jobId: job.jobId,
        payload: {
          data: job.data,
          ...(job.kind === 'flow' && job.at ? { at: job.at.toISOString() } : {}),
        } as Record<string, unknown>,
      })),
    )
    .onConflictDoNothing({ target: jobOutbox.jobId })
    .returning({ id: jobOutbox.id })
  return rows.map((row) => row.id)
}

/**
 * Enqueues staged rows and marks them enqueued. Never throws: a row that cannot be enqueued now stays pending
 * and the sweep replays it, so a Redis hiccup after commit never makes the calling job retry (and re-apply) work.
 */
export async function flushOutbox(deps: Deps, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  try {
    const rows = await deps.db
      .select()
      .from(jobOutbox)
      .where(and(inArray(jobOutbox.id, [...ids]), isNull(jobOutbox.enqueuedAt)))
      .orderBy(asc(jobOutbox.createdAt), asc(jobOutbox.id))
    await enqueueRows(deps, rows)
  } catch (error) {
    deps.log.warn({ err: error, outboxIds: ids }, 'outbox flush failed; the sweep will replay it')
  }
}

/** Sweep pass: replays rows left pending (crash or enqueue failure after commit). */
export async function replayOutbox(deps: Deps, olderThan: Date, limit: number): Promise<number> {
  const rows = await deps.db
    .select()
    .from(jobOutbox)
    .where(and(isNull(jobOutbox.enqueuedAt), lt(jobOutbox.createdAt, olderThan)))
    .orderBy(asc(jobOutbox.createdAt), asc(jobOutbox.id))
    .limit(limit)
  return enqueueRows(deps, rows)
}

async function enqueueRows(deps: Deps, rows: readonly OutboxRow[]): Promise<number> {
  let enqueued = 0
  for (const row of rows) {
    try {
      await dispatch(deps, row)
      await deps.db.update(jobOutbox).set({ enqueuedAt: deps.now() }).where(eq(jobOutbox.id, row.id))
      enqueued++
    } catch (error) {
      deps.log.warn({ err: error, outboxId: row.id, jobId: row.jobId }, 'could not enqueue outbox job')
    }
  }
  return enqueued
}

async function dispatch(deps: Deps, row: OutboxRow): Promise<void> {
  const payload = row.payload as { data: unknown; at?: string }
  if (row.queue === 'outbound') return deps.jobs.outbound(payload.data as OutboundJobData)
  if (row.name === 'follow_check') return deps.jobs.followCheck(payload.data as FollowCheckJobData, { jobId: row.jobId })
  return deps.jobs.flow(payload.data as FlowJobData, {
    jobId: row.jobId,
    ...(payload.at ? { at: new Date(payload.at) } : {}),
  })
}
