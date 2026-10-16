import type { Tx } from '@replyooo/db'
import { contacts, subscriptions, usageCounters } from '@replyooo/db'
import { effectivePlan, PLAN_LIMITS, usagePeriod } from '@replyooo/shared'
import { and, eq, isNull, lt, ne, or, sql } from 'drizzle-orm'
import type { ContactRow } from './records'

/**
 * Spec §2.4: past the monthly contact limit no new runs start (in-flight runs finish). A contact
 * already counted this period costs nothing more, so it may still start runs.
 *
 * A contact not yet counted this period reserves its slot here, inside the transaction that starts
 * the run: the contact is marked counted and the period's counter is bumped only while it is under
 * the limit, in one conditional upsert, so concurrent runs for new contacts can't overshoot. The
 * reservation is kept even if the run ends up sending nothing (the contact was reached for the
 * limit's purposes). `countUsage` in outbound stays as an idempotent backstop for runs that send
 * in a later period than they started.
 */
export async function mayStartRun(tx: Tx, workspaceId: string, contact: ContactRow, now: Date): Promise<boolean> {
  const period = usagePeriod(now)
  if (contact.lastCountedPeriod === period) return true
  // Claiming the contact row first serialises two runs for the same contact: the second sees it counted.
  const claimed = await tx
    .update(contacts)
    .set({ lastCountedPeriod: period })
    .where(and(eq(contacts.id, contact.id), or(isNull(contacts.lastCountedPeriod), ne(contacts.lastCountedPeriod, period))))
    .returning({ id: contacts.id })
  if (claimed.length === 0) return true
  const [subscription] = await tx
    .select({ plan: subscriptions.plan, status: subscriptions.status, currentPeriodEnd: subscriptions.currentPeriodEnd })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
  const limit = PLAN_LIMITS[effectivePlan(subscription, now)].contactsPerMonth
  const reserved =
    limit > 0
      ? await tx
          .insert(usageCounters)
          .values({ workspaceId, period, contactsReached: 1 })
          .onConflictDoUpdate({
            target: [usageCounters.workspaceId, usageCounters.period],
            set: { contactsReached: sql`${usageCounters.contactsReached} + 1`, updatedAt: now },
            setWhere: lt(usageCounters.contactsReached, limit),
          })
          .returning({ id: usageCounters.id })
      : []
  if (reserved.length > 0) return true
  // Over the limit: undo the claim so the contact is still uncounted this period.
  await tx.update(contacts).set({ lastCountedPeriod: contact.lastCountedPeriod }).where(eq(contacts.id, contact.id))
  return false
}
