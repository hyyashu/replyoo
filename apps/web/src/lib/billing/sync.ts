import 'server-only'
import { type Db, subscriptions, workspaces } from '@replyooo/db'
import { PAID_STATUSES } from '@replyooo/shared'
import { and, eq, isNull, lte, or } from 'drizzle-orm'
import { z } from 'zod'
import { isUuid } from '../data/ids'
import { type DodoConfig, planForProduct } from './dodo'

const SubscriptionEvent = z.object({
  type: z.string().startsWith('subscription.'),
  timestamp: z.iso.datetime({ offset: true }),
  data: z.object({
    payload_type: z.literal('Subscription'),
    subscription_id: z.string().min(1),
    product_id: z.string().min(1),
    status: z.string().min(1),
    customer: z.object({ customer_id: z.string().min(1) }),
    next_billing_date: z.string().nullish(),
    metadata: z.record(z.string(), z.unknown()).nullish(),
  }),
})
type SubscriptionData = z.infer<typeof SubscriptionEvent>['data']

export type SyncResult = 'updated' | 'stale' | 'ignored' | 'unknown_product' | 'unknown_workspace'

/** Checkout metadata first, then the subscription or customer we already stored. */
async function findWorkspace(db: Db, data: SubscriptionData): Promise<string | null> {
  const fromMetadata = data.metadata?.workspace_id
  if (typeof fromMetadata === 'string' && isUuid(fromMetadata)) {
    const [row] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, fromMetadata))
    if (row) return row.id
  }
  const [bySubscription] = await db
    .select({ workspaceId: subscriptions.workspaceId })
    .from(subscriptions)
    .where(eq(subscriptions.dodoSubscriptionId, data.subscription_id))
  if (bySubscription) return bySubscription.workspaceId
  const [byCustomer] = await db
    .select({ workspaceId: subscriptions.workspaceId })
    .from(subscriptions)
    .where(eq(subscriptions.dodoCustomerId, data.customer.customer_id))
  return byCustomer?.workspaceId ?? null
}

/**
 * Spec §5.3: Dodo `subscription.*` webhooks upsert the workspace's `subscriptions` row. Webhooks can
 * arrive out of order, so an event older than the last one applied is ignored, and a non-paying
 * event about a different subscription never replaces the one on file.
 */
export async function applyDodoEvent(db: Db, products: DodoConfig['products'], payload: unknown): Promise<SyncResult> {
  const parsed = SubscriptionEvent.safeParse(payload)
  if (!parsed.success) return 'ignored'
  const { data, timestamp } = parsed.data
  const plan = planForProduct(products, data.product_id)
  if (!plan) return 'unknown_product'
  const workspaceId = await findWorkspace(db, data)
  if (!workspaceId) return 'unknown_workspace'

  const eventAt = new Date(timestamp)
  const values = {
    plan,
    status: data.status,
    dodoCustomerId: data.customer.customer_id,
    dodoSubscriptionId: data.subscription_id,
    currentPeriodEnd: data.next_billing_date ? new Date(data.next_billing_date) : null,
    dodoEventAt: eventAt,
  }
  const fresh = or(isNull(subscriptions.dodoEventAt), lte(subscriptions.dodoEventAt, eventAt))
  const sameSubscription = or(isNull(subscriptions.dodoSubscriptionId), eq(subscriptions.dodoSubscriptionId, data.subscription_id))
  const rows = await db
    .insert(subscriptions)
    .values({ workspaceId, ...values })
    .onConflictDoUpdate({
      target: subscriptions.workspaceId,
      set: values,
      setWhere: PAID_STATUSES.includes(data.status) ? fresh : and(fresh, sameSubscription),
    })
    .returning({ id: subscriptions.id })
  return rows.length > 0 ? 'updated' : 'stale'
}
