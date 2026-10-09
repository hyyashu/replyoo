import 'server-only'
import { subscriptions } from '@replyooo/db'
import { effectivePlan } from '@replyooo/shared'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { appUrl } from '../env'
import { changeSubscriptionPlan, createCheckout, createPortalSession, productFor, type DodoConfig, type PlanChoice } from './dodo'
import { checkoutCountryFields } from './dodo-catalog'

/** Dodo statuses where the subscription still exists and resumes once the payment method is fixed. */
const RECOVERABLE_STATUSES: readonly string[] = ['on_hold']

/**
 * Where to send the browser to move a workspace to `choice` (plan + billing interval). One subscription per workspace:
 * a live paid subscription changes product in place (any of the four, prorated); one on hold for a failed payment goes
 * to the customer portal (a new checkout would leave the held subscription to resume later and bill twice); anything
 * else (free, lapsed) gets a new checkout, billed in the visitor's country price when Dodo has one.
 */
export async function startPlanChange(
  config: DodoConfig,
  workspace: { workspaceId: string; user: { email: string; name: string } },
  choice: PlanChoice,
  options: { country?: string | null; now?: Date } = {},
): Promise<string> {
  const now = options.now ?? new Date()
  const productId = productFor(config.products, choice)
  const returnUrl = appUrl('/settings?billing=updated#billing')
  const [current] = await db().select().from(subscriptions).where(eq(subscriptions.workspaceId, workspace.workspaceId))
  if (current?.dodoSubscriptionId && effectivePlan(current, now) !== 'free') {
    if (current.plan === choice.plan && current.billingInterval === choice.interval) return returnUrl
    return (await changeSubscriptionPlan(config, current.dodoSubscriptionId, productId)) ?? returnUrl
  }
  if (current?.dodoSubscriptionId && current.dodoCustomerId && RECOVERABLE_STATUSES.includes(current.status)) {
    return createPortalSession(config, current.dodoCustomerId, appUrl('/settings#billing'))
  }
  return createCheckout(config, {
    productId,
    workspaceId: workspace.workspaceId,
    customer: current?.dodoCustomerId ? { customerId: current.dodoCustomerId } : { email: workspace.user.email, name: workspace.user.name },
    returnUrl,
    extra: checkoutCountryFields(options.country ?? null),
  })
}

export async function billingCustomer(workspaceId: string): Promise<string | null> {
  const [row] = await db()
    .select({ customerId: subscriptions.dodoCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
  return row?.customerId ?? null
}
