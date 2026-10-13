import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm'
import type { Db } from './client'
import { automationEntries, backfillRuns, contacts, flowRuns, messages } from './schema'

/** Meta only allows a private reply within 7 days of the comment. */
export const BACKFILL_WINDOWS_HOURS = [24, 72, 168] as const
export const BACKFILL_MAX_COMMENTS = 500
const STUCK_AFTER_MS = 30 * 60_000

export type BackfillRun = typeof backfillRuns.$inferSelect

export interface BackfillOutcome {
  found: number
  skippedHandled: number
  skippedNoMatch: number
  enqueued: number
  capped: boolean
}

export type BackfillResult = ({ status: 'done' } & BackfillOutcome) | { status: 'failed'; error: string }

/** Starts a run, or returns the automation's active one (a double click must not error or double-send). */
export async function createBackfillRun(
  db: Db,
  input: { automationId: string; connectedAccountId: string; windowHours: number },
): Promise<{ run: BackfillRun; created: boolean }> {
  const [row] = await db.insert(backfillRuns).values(input).onConflictDoNothing().returning()
  if (row) return { run: row, created: true }
  const [active] = await db
    .select()
    .from(backfillRuns)
    .where(and(eq(backfillRuns.automationId, input.automationId), inArray(backfillRuns.status, ['queued', 'running'])))
  if (!active) throw new Error('Could not start the run')
  return { run: active, created: false }
}

export async function latestBackfillRun(db: Db, automationId: string): Promise<BackfillRun | null> {
  const [row] = await db
    .select()
    .from(backfillRuns)
    .where(eq(backfillRuns.automationId, automationId))
    .orderBy(desc(backfillRuns.createdAt), desc(backfillRuns.id))
    .limit(1)
  return row ?? null
}

export async function queuedBackfillRunIds(db: Db, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: backfillRuns.id })
    .from(backfillRuns)
    .where(eq(backfillRuns.status, 'queued'))
    .orderBy(asc(backfillRuns.createdAt), asc(backfillRuns.id))
    .limit(limit)
  return rows.map((row) => row.id)
}

/** Moves a queued run to running. Only one caller wins, so a job delivered twice does the work once. */
export async function claimBackfillRun(db: Db, id: string, now: Date): Promise<BackfillRun | null> {
  const [row] = await db
    .update(backfillRuns)
    .set({ status: 'running', startedAt: now })
    .where(and(eq(backfillRuns.id, id), eq(backfillRuns.status, 'queued')))
    .returning()
  return row ?? null
}

export async function finishBackfillRun(db: Db, id: string, result: BackfillResult, now: Date): Promise<void> {
  const values =
    result.status === 'done'
      ? {
          status: 'done' as const,
          found: result.found,
          skippedHandled: result.skippedHandled,
          skippedNoMatch: result.skippedNoMatch,
          enqueued: result.enqueued,
          capped: result.capped,
          error: null,
        }
      : { status: 'failed' as const, error: result.error }
  await db
    .update(backfillRuns)
    .set({ ...values, finishedAt: now })
    .where(eq(backfillRuns.id, id))
}

/** A worker that died mid-run would otherwise block the automation's next run forever. */
export async function failStuckBackfillRuns(db: Db, now: Date): Promise<number> {
  const rows = await db
    .update(backfillRuns)
    .set({ status: 'failed', error: 'timed_out', finishedAt: now })
    .where(and(eq(backfillRuns.status, 'running'), lt(backfillRuns.startedAt, new Date(now.getTime() - STUCK_AFTER_MS))))
    .returning({ id: backfillRuns.id })
  return rows.length
}

/**
 * Comment ids that already got an answer: a flow run was started for them, or we sent an outbound message about
 * them. An inbound `comment` message alone does not count; the webhook stores one even when no automation matched.
 */
export async function handledCommentIds(db: Db, accountId: string, commentIds: readonly string[]): Promise<Set<string>> {
  if (commentIds.length === 0) return new Set()
  const ids = [...commentIds]
  const runs = await db
    .select({ commentId: flowRuns.commentId })
    .from(flowRuns)
    .where(and(eq(flowRuns.connectedAccountId, accountId), inArray(flowRuns.commentId, ids)))
  const sent = await db
    .select({ commentId: messages.commentId })
    .from(messages)
    .where(and(eq(messages.connectedAccountId, accountId), eq(messages.direction, 'out'), inArray(messages.commentId, ids)))
  const handled = new Set<string>()
  for (const row of [...runs, ...sent]) if (row.commentId) handled.add(row.commentId)
  return handled
}

/**
 * Comment ids a re-run must leave alone: ones that were answered (see `handledCommentIds`), and any comment by a
 * person this automation has already run for. The live path drops a repeat commenter on the 24-hour cooldown, but
 * that cooldown is measured from now, so a re-run days later would otherwise DM them a second time.
 */
export async function answeredCommentIds(
  db: Db,
  input: { accountId: string; automationId: string; comments: readonly { id: string; authorId: string }[] },
): Promise<Set<string>> {
  const answered = await handledCommentIds(db, input.accountId, input.comments.map((c) => c.id))
  if (input.comments.length === 0) return answered
  const entered = await db
    .select({ platformUserId: contacts.platformUserId })
    .from(automationEntries)
    .innerJoin(contacts, eq(contacts.id, automationEntries.contactId))
    .where(
      and(
        eq(automationEntries.automationId, input.automationId),
        eq(contacts.connectedAccountId, input.accountId),
        inArray(contacts.platformUserId, [...new Set(input.comments.map((c) => c.authorId))]),
      ),
    )
  const enteredIds = new Set(entered.map((row) => row.platformUserId))
  for (const comment of input.comments) if (enteredIds.has(comment.authorId)) answered.add(comment.id)
  return answered
}
