import 'server-only'
import { automations, type Db, subscriptions, type Tx } from '@replyooo/db'
import { effectivePlan, PLAN_LIMITS, PLAN_NAMES, type PlanKey } from '@replyooo/shared'
import { and, count, eq, ne, not } from 'drizzle-orm'

/** The plan whose limits apply now. `lock` serialises limit checks for one workspace inside a transaction. */
export async function workspacePlan(executor: Db | Tx, workspaceId: string, now: Date, lock = false): Promise<PlanKey> {
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
