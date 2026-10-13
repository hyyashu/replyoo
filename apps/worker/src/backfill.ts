import {
  automations,
  automationVersions,
  BACKFILL_MAX_COMMENTS,
  claimBackfillRun,
  connectedAccounts,
  finishBackfillRun,
  handledCommentIds,
  webhookEvents,
} from '@replyooo/db'
import type { TriggerCandidate } from '@replyooo/engine'
import { classifyComments } from '@replyooo/engine'
import type { NormalizedEvent } from '@replyooo/meta'
import { gatherComments, MetaError } from '@replyooo/meta'
import { eq } from 'drizzle-orm'
import { flagReauth } from './alerts'
import type { Deps } from './deps'
import { credentials } from './records'

class BackfillFailure extends Error {}

/**
 * Runs one "run on existing comments" request. Comments are not answered here: each eligible one becomes a
 * `comment_created` event (limited to this automation) and goes through the normal inbound job, so matching,
 * plan limits, the re-entry cooldown, the flow and sending are the code live comments already use.
 * Failures end the run with a reason rather than retrying; the user can run it again.
 */
export async function handleBackfill(deps: Deps, runId: string, opts: { maxComments?: number } = {}): Promise<void> {
  const { db } = deps
  const run = await claimBackfillRun(db, runId, deps.now())
  if (!run) return
  try {
    const outcome = await execute(deps, run, opts.maxComments ?? BACKFILL_MAX_COMMENTS)
    await finishBackfillRun(db, run.id, { status: 'done', ...outcome }, deps.now())
  } catch (error) {
    let reason = 'unexpected_error'
    if (error instanceof BackfillFailure) {
      reason = error.message
    } else if (error instanceof MetaError) {
      reason = error.details.reason ?? error.kind
      if (error.kind === 'reauth') await flagReauth(deps, run.connectedAccountId)
    } else {
      deps.log.error({ err: error, runId }, 'backfill failed')
    }
    await finishBackfillRun(db, run.id, { status: 'failed', error: reason }, deps.now())
  }
}

async function execute(deps: Deps, run: { id: string; automationId: string; windowHours: number }, max: number) {
  const { db } = deps
  const now = deps.now()
  const [row] = await db
    .select({
      automation: automations,
      account: connectedAccounts,
      definition: automationVersions.definition,
      publishedAt: automationVersions.publishedAt,
    })
    .from(automations)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, automations.connectedAccountId))
    .innerJoin(automationVersions, eq(automationVersions.id, automations.currentVersionId))
    .where(eq(automations.id, run.automationId))
  if (!row || row.automation.status !== 'active') throw new BackfillFailure('automation_not_active')
  if (row.account.status !== 'active') throw new BackfillFailure('account_inactive')
  const trigger = row.definition.trigger
  if (trigger.type !== 'comment_keyword') throw new BackfillFailure('not_a_comment_automation')

  const { account } = row
  const adapter = deps.adapters[account.platform]
  const since = new Date(now.getTime() - run.windowHours * 3_600_000)
  const gathered = await gatherComments(adapter, credentials(account, deps.tokenKey), {
    trigger,
    pinnedMediaId: row.automation.pinnedMediaId,
    since,
    max,
  })
  const others = gathered.comments.filter((comment) => comment.authorId !== account.externalId)
  const handled = await handledCommentIds(db, account.id, others.map((c) => c.id))
  const candidate: TriggerCandidate = {
    automationId: row.automation.id,
    publishedAt: row.publishedAt,
    trigger,
    pinnedMediaId: row.automation.pinnedMediaId,
  }
  const buckets = classifyComments(others, candidate, handled, now)

  let enqueued = 0
  for (const comment of buckets.eligible) {
    const event: NormalizedEvent = {
      type: 'comment_created',
      platform: account.platform,
      accountExternalId: account.externalId,
      dedupKey: `backfill:${run.id}:${comment.id}`,
      occurredAt: comment.createdAt.toISOString(),
      senderId: comment.authorId,
      commentId: comment.id,
      mediaId: comment.mediaId,
      text: comment.text,
      senderUsername: comment.authorUsername,
      senderName: comment.authorName,
      restrictToAutomationId: row.automation.id,
    }
    const [stored] = await db
      .insert(webhookEvents)
      .values({ platform: account.platform, dedupKey: event.dedupKey, payload: event })
      .onConflictDoNothing({ target: webhookEvents.dedupKey })
      .returning({ id: webhookEvents.id })
    if (!stored) continue
    await deps.jobs.inbound(stored.id)
    enqueued++
  }
  return {
    found: others.length,
    skippedHandled: buckets.handled.length,
    skippedNoMatch: buckets.no_match.length + buckets.too_old.length,
    enqueued,
    capped: gathered.capped,
  }
}
