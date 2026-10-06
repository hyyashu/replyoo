import { automationVersions, connectedAccounts, contacts, flowRuns, messages } from '@replyooo/db'
import type { Effect, OutboundMessage, Wait } from '@replyooo/engine'
import { advance } from '@replyooo/engine'
import { MetaError } from '@replyooo/meta'
import { and, eq, ne, sql } from 'drizzle-orm'
import { flagReauth } from './alerts'
import type { Deps, FlowJobData, FollowCheckJobData } from './deps'
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

export async function handleFlowJob(deps: Deps, job: FlowJobData): Promise<void> {
  const now = deps.now()
  const outcome = await deps.db.transaction(async (tx) => {
    const [row] = await tx.select().from(flowRuns).where(eq(flowRuns.id, job.runId)).for('update')
    if (!row) return null
    if (job.expectedVersion !== undefined && row.stateVersion !== job.expectedVersion) return null
    if (row.status !== 'running' && row.status !== 'waiting') return null

    const [contact] = await tx.select().from(contacts).where(eq(contacts.id, row.contactId)).for('update')
    const [version] = await tx
      .select({ definition: automationVersions.definition })
      .from(automationVersions)
      .where(eq(automationVersions.id, row.automationVersionId))
    if (!contact || !version) return null

    const result = advance({
      run: toRunState(row),
      flow: version.definition,
      contact: toContactState(contact),
      event: job.event,
      now,
    })
    if (result.ignored) return null

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
    for (const out of outboundRows(result.effects)) {
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
        })
        .returning({ id: messages.id })
      messageIds.push(inserted!.id)
    }
    return { version: result.run.stateVersion, effects: result.effects, messageIds }
  })
  if (!outcome) return

  if (outcome.messageIds.length > 0) await deps.jobs.outbound({ messageIds: outcome.messageIds })
  for (const effect of outcome.effects) {
    if (effect.type === 'schedule_timeout') {
      await deps.jobs.flow(
        { runId: job.runId, event: { type: 'timeout' }, expectedVersion: outcome.version },
        { at: effect.at, jobId: `timeout-${job.runId}-${outcome.version}` },
      )
    }
    if (effect.type === 'check_follow') {
      await deps.jobs.followCheck({ runId: job.runId, expectedVersion: outcome.version })
    }
  }
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
  let following = false
  if (adapter.isFollower) {
    try {
      following = await adapter.isFollower(credentials(account, deps.tokenKey), contact.platformUserId)
    } catch (error) {
      if (!(error instanceof MetaError) || error.kind === 'retryable') throw error
      if (error.kind === 'reauth') await flagReauth(deps, account.id)
      await endRun(deps.db, run.id, 'failed', error.details.reason ?? error.kind, deps.now())
      return
    }
  }
  await deps.jobs.flow({
    runId: run.id,
    event: { type: 'follow_result', following },
    expectedVersion: job.expectedVersion,
  })
}
