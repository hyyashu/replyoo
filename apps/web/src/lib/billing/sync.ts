import 'server-only'
import { billingWebhookEvents, type Db, subscriptions, type Tx, workspaces } from '@replyooo/db'
import { PAID_STATUSES } from '@replyooo/shared'
import { and, eq, isNull, lt, or, type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'
import { isUuid } from '../data/ids'
import { planForProduct, type ProductTable } from './dodo'

const SubscriptionEvent = z.object({
  type: z.string().startsWith('subscription.'),
  timestamp: z.iso.datetime({ offset: true }),
  data: z.object({
    payload_type: z.literal('Subscription'),
    subscription_id: z.string().min(1),
    product_id: z.string().min(1),
    status: z.string().min(1),
    customer: z.object({ customer_id: z.string().min(1) }),
    next_billing_date: z.iso.datetime({ offset: true }).nullish(),
    metadata: z.record(z.string(), z.unknown()).nullish(),
  }),
})
type SubscriptionData = z.infer<typeof SubscriptionEvent>['data']

export type SyncResult = 'updated' | 'stale' | 'duplicate' | 'ignored' | 'unknown_product' | 'unknown_workspace'

/**
 * Tie-breaker for two events with the same `timestamp`: the one further along the subscription
 * lifecycle wins, whichever arrives last. At equal rank (or two unknown statuses, ranked lowest) the
 * later-arriving event wins only if it changes the plan, interval, period end or Dodo ids (e.g. a plan
 * change emitted in the same second); an identical payload is stale, so redeliveries never churn the row.
 */
export const STATUS_PRECEDENCE: readonly string[] = ['pending', 'active', 'past_due', 'on_hold', 'failed', 'cancelled', 'expired']

function statusRank(status: string | SQL): SQL {
  const cases = STATUS_PRECEDENCE.map((s, i) => sql`when ${s} then ${i}`)
  return sql`(case ${status} ${sql.join(cases, sql` `)} else -1 end)`
}

/**
 * The workspace that already holds this subscription id wins (the id is unique across workspaces), then
 * checkout metadata, then an unambiguous customer id.
 */
async function findWorkspace(db: Db | Tx, data: SubscriptionData): Promise<string | null> {
  const [bySubscription] = await db
    .select({ workspaceId: subscriptions.workspaceId })
    .from(subscriptions)
    .where(eq(subscriptions.dodoSubscriptionId, data.subscription_id))
  if (bySubscription) return bySubscription.workspaceId
  const fromMetadata = data.metadata?.workspace_id
  if (typeof fromMetadata === 'string' && isUuid(fromMetadata)) {
    const [row] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, fromMetadata))
    if (row) return row.id
  }
  // One Dodo customer can pay for several workspaces; only trust the customer id when it is unambiguous.
  const byCustomer = await db
    .select({ workspaceId: subscriptions.workspaceId })
    .from(subscriptions)
    .where(eq(subscriptions.dodoCustomerId, data.customer.customer_id))
    .limit(2)
  return byCustomer.length === 1 ? (byCustomer[0]?.workspaceId ?? null) : null
}

/**
 * Spec §5.3: Dodo `subscription.*` webhooks upsert the workspace's `subscriptions` row. Webhooks can
 * arrive out of order, so an event older than the last one applied is ignored, and a non-paying
 * event about a different subscription never replaces the one on file. Only a strictly newer event, or one
 * with the same timestamp and a later status (STATUS_PRECEDENCE), is applied. A `webhookId` already
 * handled is a redelivery and is skipped; it is recorded in the same transaction that applies the event.
 */
export async function applyDodoEvent(db: Db, products: ProductTable, payload: unknown, webhookId?: string | null): Promise<SyncResult> {
  const parsed = SubscriptionEvent.safeParse(payload)
  if (!parsed.success) return 'ignored'
  const { data } = parsed.data
  const choice = planForProduct(products, data.product_id)
  if (!choice) return 'unknown_product'
  try {
    return await applyInTransaction(db, choice, parsed.data, webhookId)
  } catch (error) {
    // Two first events for one new subscription id raced onto different workspaces; the other one won.
    if (!isUniqueViolation(error, 'subscriptions_dodo_subscription_uq')) throw error
    console.warn('dodo subscription id already claimed by another workspace', { subscriptionId: data.subscription_id, webhookId })
    return 'unknown_workspace'
  }
}

/** Postgres unique violation on `constraint`, whether thrown directly by postgres-js or wrapped by drizzle. */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let e: unknown = error, depth = 0; e && typeof e === 'object' && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const pg = e as { code?: unknown; constraint_name?: unknown }
    if (pg.code === '23505' && pg.constraint_name === constraint) return true
  }
  return false
}

async function applyInTransaction(
  db: Db,
  choice: NonNullable<ReturnType<typeof planForProduct>>,
  event: z.infer<typeof SubscriptionEvent>,
  webhookId: string | null | undefined,
): Promise<SyncResult> {
  const { data, timestamp } = event
  return db.transaction(async (tx) => {
    // Resolve the workspace before recording the webhook id: an event we can't place yet must stay
    // retryable (Dodo redelivers it), not be marked handled.
    const workspaceId = await findWorkspace(tx, data)
    if (!workspaceId) return 'unknown_workspace'
    if (webhookId) {
      const first = await tx
        .insert(billingWebhookEvents)
        .values({ webhookId, type: event.type })
        .onConflictDoNothing()
        .returning({ webhookId: billingWebhookEvents.webhookId })
      if (first.length === 0) return 'duplicate'
    }

    const eventAt = new Date(timestamp)
    const values = {
      plan: choice.plan,
      billingInterval: choice.interval,
      status: data.status,
      dodoCustomerId: data.customer.customer_id,
      dodoSubscriptionId: data.subscription_id,
      currentPeriodEnd: data.next_billing_date ? new Date(data.next_billing_date) : null,
      dodoEventAt: eventAt,
    }
    const fresh = or(
      isNull(subscriptions.dodoEventAt),
      lt(subscriptions.dodoEventAt, eventAt),
      and(
        eq(subscriptions.dodoEventAt, eventAt),
        or(
          sql`${statusRank(data.status)} > ${statusRank(sql`${subscriptions.status}`)}`,
          and(
            sql`${statusRank(data.status)} = ${statusRank(sql`${subscriptions.status}`)}`,
            sql`(${subscriptions.plan}, ${subscriptions.billingInterval}, ${subscriptions.currentPeriodEnd}, ${subscriptions.dodoSubscriptionId}, ${subscriptions.dodoCustomerId})
              is distinct from (excluded.plan, excluded.billing_interval, excluded.current_period_end, excluded.dodo_subscription_id, excluded.dodo_customer_id)`,
          ),
        ),
      ),
    )
    const sameSubscription = or(isNull(subscriptions.dodoSubscriptionId), eq(subscriptions.dodoSubscriptionId, data.subscription_id))
    const rows = await tx
      .insert(subscriptions)
      .values({ workspaceId, ...values })
      .onConflictDoUpdate({
        target: subscriptions.workspaceId,
        set: values,
        setWhere: PAID_STATUSES.includes(data.status) ? fresh : and(fresh, sameSubscription),
      })
      .returning({ id: subscriptions.id })
    return rows.length > 0 ? 'updated' : 'stale'
  })
}
