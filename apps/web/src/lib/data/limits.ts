import 'server-only'
import { automations, connectedAccounts, type Db, subscriptions, type Tx, workspaceInvitations, workspaceMembers } from '@replyooo/db'
import { effectivePlan, MAX_TEAM_SEATS, PLAN_LIMITS, PLAN_NAMES, type Platform, type PlanKey } from '@replyooo/shared'
import { and, count, eq, ne, not } from 'drizzle-orm'
import { lockWorkspaceLimits } from '../locks'

/**
 * Plan-limit checks. Every `*Block`/`has*` function here must run inside a transaction and takes the
 * workspace's limit lock first, so a check and the insert that follows it in the same transaction
 * can't interleave with another one for the same workspace (parallel OAuth callbacks, invites, publishes).
 */

/** The plan whose limits apply now. `lock` serialises limit checks for one workspace inside a transaction. */
export async function workspacePlan(executor: Db | Tx, workspaceId: string, now: Date, lock = false): Promise<PlanKey> {
  // Not every workspace has a subscriptions row to lock (one is only guaranteed for personal workspaces,
  // and webhooks may create it later), so the lock is a transaction-scoped advisory lock on the workspace
  // id; the row itself is locked too so a plan change can't land mid-check.
  if (lock) await lockWorkspaceLimits(executor, workspaceId)
  const query = executor
    .select({ plan: subscriptions.plan, status: subscriptions.status, currentPeriodEnd: subscriptions.currentPeriodEnd })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
  const [row] = lock ? await query.for('update') : await query
  return effectivePlan(row, now)
}

/**
 * Spec §3.6 live-automation limit. Null when `automation` may go live, otherwise the message to show.
 * Publishing a conversation starter pauses the account's other live one, so that one isn't counted.
 */
export async function liveAutomationBlock(
  tx: Tx,
  workspaceId: string,
  automation: { id: string; connectedAccountId: string },
  replacesIceBreaker: boolean,
  now: Date,
): Promise<string | null> {
  const plan = await workspacePlan(tx, workspaceId, now, true)
  const limit = PLAN_LIMITS[plan].liveAutomations
  if (limit === null) return null
  const [row] = await tx
    .select({ live: count() })
    .from(automations)
    .where(
      and(
        eq(automations.workspaceId, workspaceId),
        eq(automations.status, 'active'),
        ne(automations.id, automation.id),
        replacesIceBreaker
          ? not(and(eq(automations.connectedAccountId, automation.connectedAccountId), eq(automations.triggerType, 'ice_breaker'))!)
          : undefined,
      ),
    )
  if ((row?.live ?? 0) < limit) return null
  return `Your ${PLAN_NAMES[plan]} plan allows ${limit} live automations. Pause one or upgrade in Settings → Billing.`
}

/** Spec §3.6 connected-account limit. Reconnecting an account this workspace already has never needs a new slot. */
export async function hasAccountSlot(tx: Tx, workspaceId: string, platform: Platform, externalId: string, now: Date): Promise<boolean> {
  const plan = await workspacePlan(tx, workspaceId, now, true)
  const rows = await tx
    .select({ platform: connectedAccounts.platform, externalId: connectedAccounts.externalId })
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.workspaceId, workspaceId), ne(connectedAccounts.status, 'disconnected')))
  if (rows.some((row) => row.platform === platform && row.externalId === externalId)) return true
  return rows.length < PLAN_LIMITS[plan].connectedAccounts
}

/** MAX_TEAM_SEATS counts members plus pending invites. */
export async function hasTeamSeat(tx: Tx, workspaceId: string, now: Date): Promise<boolean> {
  await workspacePlan(tx, workspaceId, now, true)
  const [[members], [invitations]] = await Promise.all([
    tx.select({ n: count() }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId)),
    tx.select({ n: count() }).from(workspaceInvitations).where(eq(workspaceInvitations.workspaceId, workspaceId)),
  ])
  return (members?.n ?? 0) + (invitations?.n ?? 0) < MAX_TEAM_SEATS
}
