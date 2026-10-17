import { automationVersions, connectedAccounts, contacts, flowRuns, messages } from '@replyooo/db'
import type { Effect, OutboundMessage, Wait } from '@replyooo/engine'
import { advance } from '@replyooo/engine'
import { MetaError } from '@replyooo/meta'
import { and, eq, ne, sql } from 'drizzle-orm'
import { flagReauth } from './alerts'
import type { Deps, FlowJobData, FollowCheckJobData } from './deps'
import type { OutboxJob } from './outbox'
import { flushOutbox, stageJobs } from './outbox'
import {
  applyContactEffects,
  credentials,
  endRun,
  runColumns,
  toContactState,
  toRunState,
} from './records'

export type OutboundBody =
  | { type: 'message'; message: OutboundMessage }
  | { type: 'image'; url: string }
  | { type: 'comment'; text: string }

type OutboundKind = 'dm' | 'private_reply' | 'comment_reply'

export function outboundRows(
  effects: readonly Effect[],
): { kind: OutboundKind; commentId: string | null; body: OutboundBody }[] {
  const rows: { kind: OutboundKind; commentId: string | null; body: OutboundBody }[] = []
  for (const effect of effects) {
    switch (effect.type) {
      case 'send': {
        const { imageUrl, ...message } = effect.message
        if (imageUrl) rows.push({ kind: 'dm', commentId: null, body: { type: 'image', url: imageUrl } })
        rows.push({ kind: 'dm', commentId: null, body: { type: 'message', message } })
        break
      }
      case 'private_reply': {
        // Validation keeps images off a comment flow's first message; drop one defensively.
        const { imageUrl: _image, ...message } = effect.message
        rows.push({ kind: 'private_reply', commentId: effect.commentId, body: { type: 'message', message } })
        break
      }
      case 'comment_reply':
        rows.push({ kind: 'comment_reply', commentId: effect.commentId, body: { type: 'comment', text: effect.text } })
        break
    }
  }
  return rows
}

/** `early`: a timeout job ran before its run's deadline (clock skew, an early sweep); retry it at `retryAt`. */
export type FlowJobResult = { status: 'done' } | { status: 'early'; retryAt: Date }

export async function handleFlowJob(deps: Deps, job: FlowJobData): Promise<FlowJobResult> {
  const now = deps.now()
  let early: Date | null = null
  const staged = await deps.db.transaction(async (tx) => {
    // Lock the contact before the run, the same order inbound uses, so the two never deadlock.
    const [peek] = await tx.select({ contactId: flowRuns.contactId }).from(flowRuns).where(eq(flowRuns.id, job.runId))
    if (!peek) return []
    const [contact] = await tx.select().from(contacts).where(eq(contacts.id, peek.contactId)).for('update')
    const [row] = await tx.select().from(flowRuns).where(eq(flowRuns.id, job.runId)).for('update')
    if (!row || !contact) return []
    if (job.expectedVersion !== undefined && row.stateVersion !== job.expectedVersion) return []
    if (row.status !== 'running' && row.status !== 'waiting') return []

    const [version] = await tx
      .select({ definition: automationVersions.definition })
      .from(automationVersions)
      .where(eq(automationVersions.id, row.automationVersionId))
    if (!version) return []

    const result = advance({
      run: toRunState(row),
      flow: version.definition,
      contact: toContactState(contact),
      event: job.event,
      now,
    })
    if (result.ignored) {
      if (job.event.type === 'timeout' && row.status === 'waiting') {
        // Too early: the same job is delayed, since a restaged one would collide with its outbox row.
        if (row.waitUntil && now < row.waitUntil) {
          early = new Date(row.waitUntil.getTime() + 1000)
          return []
        }
        // A current timeout the run cannot take would be re-enqueued by the sweep forever.
        await endRun(tx, row.id, 'failed', 'timeout_ignored', now)
      }
      return []
    }

    if (result.run.status === 'waiting') {
      await tx
        .update(flowRuns)
        .set({
          status: 'cancelled',
          wait: null,
          waitUntil: null,
          completedAt: now,
          stateVersion: sql`${flowRuns.stateVersion} + 1`,
        })
        .where(and(eq(flowRuns.contactId, row.contactId), eq(flowRuns.status, 'waiting'), ne(flowRuns.id, row.id)))
    }
    await tx.update(flowRuns).set(runColumns(result.run, now)).where(eq(flowRuns.id, row.id))

    const patch = applyContactEffects(contact, result.effects)
    if (patch) await tx.update(contacts).set({ ...patch, updatedAt: now }).where(eq(contacts.id, contact.id))

    const messageIds: string[] = []
    for (const [index, out] of outboundRows(result.effects).entries()) {
      const [inserted] = await tx
        .insert(messages)
        .values({
          contactId: contact.id,
          connectedAccountId: row.connectedAccountId,
          flowRunId: row.id,
          direction: 'out',
          kind: out.kind,
          commentId: out.commentId,
          body: out.body as unknown as Record<string, unknown>,
          status: 'queued',
          createdAt: inSendOrder(index),
        })
        .returning({ id: messages.id })
      messageIds.push(inserted!.id)
    }

    // Jobs go out through the outbox: a failed enqueue after commit must not make this job retry and re-apply the event.
    const { stateVersion } = result.run
    const jobs: OutboxJob[] = []
    if (messageIds.length > 0) jobs.push({ kind: 'outbound', jobId: `out-${messageIds[0]}`, data: { messageIds } })
    for (const effect of result.effects) {
      if (effect.type === 'schedule_timeout') {
        jobs.push({
          kind: 'flow',
          jobId: `timeout-${row.id}-${stateVersion}`,
          data: { runId: row.id, event: { type: 'timeout' }, expectedVersion: stateVersion },
          at: effect.at,
        })
      }
      if (effect.type === 'check_follow') {
        jobs.push({ kind: 'follow_check', jobId: `follow-${row.id}-${stateVersion}`, data: { runId: row.id, expectedVersion: stateVersion } })
      }
    }
    return stageJobs(tx, jobs)
  })
  await flushOutbox(deps, staged)
  return early ? { status: 'early', retryAt: early } : { status: 'done' }
}

/**
 * Messages written in one transaction share now(); a microsecond offset keeps their insertion order, which is
 * the send order, so the sweep rebuilds a batch with the same first id (and job id) as the original job.
 */
export function inSendOrder(index: number) {
  return sql`now() + make_interval(secs => ${index} * 0.000001)`
}

export async function handleFollowCheck(deps: Deps, job: FollowCheckJobData): Promise<void> {
  const [row] = await deps.db
    .select({ run: flowRuns, contact: contacts, account: connectedAccounts })
    .from(flowRuns)
    .innerJoin(contacts, eq(flowRuns.contactId, contacts.id))
    .innerJoin(connectedAccounts, eq(flowRuns.connectedAccountId, connectedAccounts.id))
    .where(eq(flowRuns.id, job.runId))
  if (!row) return
  const { run, contact, account } = row
  const wait = run.wait as Wait | null
  if (run.stateVersion !== job.expectedVersion || run.status !== 'waiting' || wait?.kind !== 'follow_check') return

  const adapter = deps.adapters[account.platform]
  // Publishing rejects follow checks where the platform cannot answer them (Facebook); a run that still gets here
  // (published before that check) fails openly instead of treating everyone as not following.
  if (!adapter.isFollower) {
    await endRun(deps.db, run.id, 'failed', 'follow_check_unsupported', deps.now())
    return
  }
  let following: boolean
  try {
    following = await adapter.isFollower(credentials(account, deps.tokenKey), contact.platformUserId)
  } catch (error) {
    if (!(error instanceof MetaError) || error.kind === 'retryable') throw error
    if (error.kind === 'reauth') await flagReauth(deps, account.id)
    await endRun(deps.db, run.id, 'failed', error.details.reason ?? error.kind, deps.now())
    return
  }
  await deps.db.update(contacts).set({ followsYou: following, followCheckedAt: deps.now() }).where(eq(contacts.id, contact.id))
  await deps.jobs.flow(
    { runId: run.id, event: { type: 'follow_result', following }, expectedVersion: job.expectedVersion },
    { jobId: `follow-result-${run.id}-${job.expectedVersion}` },
  )
}
