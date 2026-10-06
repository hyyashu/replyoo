import type { Tx } from '@replyooo/db'
import { subscriptions, usageCounters } from '@replyooo/db'
import { effectivePlan, PLAN_LIMITS, usagePeriod } from '@replyooo/shared'
import { and, eq } from 'drizzle-orm'
import type { ContactRow } from './records'

/**
 * Spec §2.4: past the monthly contact limit no new runs start (in-flight runs finish). A contact
 * already counted this period costs nothing more, so it may still start runs.
 */
export async function mayStartRun(tx: Tx, workspaceId: string, contact: ContactRow, now: Date): Promise<boolean> {
  const period = usagePeriod(now)
  if (contact.lastCountedPeriod === period) return true
  const [subscription] = await tx
    .select({ plan: subscriptions.plan, status: subscriptions.status, currentPeriodEnd: subscriptions.currentPeriodEnd })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
  const [usage] = await tx
    .select({ contactsReached: usageCounters.contactsReached })
    .from(usageCounters)
    .where(and(eq(usageCounters.workspaceId, workspaceId), eq(usageCounters.period, period)))
  return (usage?.contactsReached ?? 0) < PLAN_LIMITS[effectivePlan(subscription, now)].contactsPerMonth
}
