import { connectedAccounts, encryptToken, flowRuns, messages, webhookEvents } from '@replyooo/db'
import type { StartTrigger } from '@replyooo/engine'
import { MetaError } from '@replyooo/meta'
import { and, asc, eq, gt, isNull, lt } from 'drizzle-orm'
import type { Deps } from './deps'
import { credentials, markReauthRequired } from './records'

export const SWEEP_BATCH = 500
const SECOND = 1000
const MINUTE = 60 * SECOND
const DAY = 24 * 60 * MINUTE

export async function sweep(deps: Deps) {
  const { db, jobs } = deps
  const now = deps.now().getTime()
  const ago = (ms: number) => new Date(now - ms)

  const overdue = await db
    .select({ id: flowRuns.id, stateVersion: flowRuns.stateVersion })
    .from(flowRuns)
    .where(and(eq(flowRuns.status, 'waiting'), lt(flowRuns.waitUntil, ago(30 * SECOND))))
    .limit(SWEEP_BATCH)
  for (const run of overdue) {
    await jobs.flow({ runId: run.id, event: { type: 'timeout' }, expectedVersion: run.stateVersion })
  }

  const lost = await db
    .select({ id: flowRuns.id, triggerRef: flowRuns.triggerRef })
    .from(flowRuns)
    .where(and(eq(flowRuns.status, 'running'), eq(flowRuns.stateVersion, 0), lt(flowRuns.createdAt, ago(2 * MINUTE))))
    .limit(SWEEP_BATCH)
  let starts = 0
  for (const run of lost) {
    if (!run.triggerRef) continue
    const trigger = run.triggerRef as unknown as StartTrigger
    await jobs.flow({ runId: run.id, event: { type: 'start', trigger }, expectedVersion: 0 })
    starts++
  }

  const stuck = await db
    .select({ id: messages.id, flowRunId: messages.flowRunId })
    .from(messages)
    .where(and(eq(messages.status, 'queued'), eq(messages.direction, 'out'), lt(messages.createdAt, ago(5 * MINUTE))))
    .orderBy(asc(messages.createdAt), asc(messages.id))
    .limit(SWEEP_BATCH)
  const groups = new Map<string, string[]>()
  for (const message of stuck) {
    const key = message.flowRunId ?? message.id
    groups.set(key, [...(groups.get(key) ?? []), message.id])
  }
  for (const messageIds of groups.values()) await jobs.outbound({ messageIds })

  const events = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(
      and(
        isNull(webhookEvents.processedAt),
        lt(webhookEvents.receivedAt, ago(2 * MINUTE)),
        gt(webhookEvents.receivedAt, ago(DAY)),
      ),
    )
    .limit(SWEEP_BATCH)
  for (const event of events) await jobs.inbound(event.id)

  const result = { timeouts: overdue.length, starts, messages: stuck.length, events: events.length }
  if (Object.values(result).some((n) => n > 0)) deps.log.info(result, 'sweeper re-enqueued work')
  return result
}

export async function refreshExpiringTokens(deps: Deps) {
  const { db } = deps
  const now = deps.now()
  const accounts = await db
    .select()
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.status, 'active'),
        eq(connectedAccounts.platform, 'instagram'),
        lt(connectedAccounts.tokenExpiresAt, new Date(now.getTime() + 10 * DAY)),
      ),
    )
  let refreshed = 0
  let failed = 0
  for (const account of accounts) {
    try {
      const result = await deps.adapters.instagram.refreshToken(credentials(account, deps.tokenKey))
      await db
        .update(connectedAccounts)
        .set({ accessTokenEnc: encryptToken(result.accessToken, deps.tokenKey), tokenExpiresAt: result.expiresAt })
        .where(eq(connectedAccounts.id, account.id))
      refreshed++
    } catch (error) {
      failed++
      if (error instanceof MetaError && error.kind === 'reauth') await markReauthRequired(db, account.id)
      deps.log.warn({ err: error, accountId: account.id }, 'token refresh failed')
    }
  }
  return { refreshed, failed }
}

export async function pruneWebhookEvents(deps: Deps): Promise<number> {
  const cutoff = new Date(deps.now().getTime() - 30 * DAY)
  const deleted = await deps.db
    .delete(webhookEvents)
    .where(lt(webhookEvents.receivedAt, cutoff))
    .returning({ id: webhookEvents.id })
  return deleted.length
}
