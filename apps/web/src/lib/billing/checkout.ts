import 'server-only'
import { subscriptions } from '@replyooo/db'
import { effectivePlan } from '@replyooo/shared'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { appUrl } from '../env'
import { changeSubscriptionPlan, createCheckout, type DodoConfig, type PaidPlan } from './dodo'

/**
 * Where to send the browser to move a workspace to `plan`. One subscription per workspace: a live paid
 * subscription changes plan in place; anything else (free, lapsed) gets a new checkout.
 */
export async function startPlanChange(
  config: DodoConfig,
  workspace: { workspaceId: string; user: { email: string; name: string } },
  plan: PaidPlan,
  now = new Date(),
): Promise<string> {
  const returnUrl = appUrl('/settings?billing=updated#billing')
  const [current] = await db().select().from(subscriptions).where(eq(subscriptions.workspaceId, workspace.workspaceId))
  if (current?.dodoSubscriptionId && effectivePlan(current, now) !== 'free') {
    if (current.plan === plan) return returnUrl
    return (await changeSubscriptionPlan(config, current.dodoSubscriptionId, config.products[plan])) ?? returnUrl
  }
  return createCheckout(config, {
    productId: config.products[plan],
    workspaceId: workspace.workspaceId,
    customer: current?.dodoCustomerId ? { customerId: current.dodoCustomerId } : { email: workspace.user.email, name: workspace.user.name },
    returnUrl,
  })
}

export async function billingCustomer(workspaceId: string): Promise<string | null> {
  const [row] = await db()
    .select({ customerId: subscriptions.dodoCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
  return row?.customerId ?? null
}
