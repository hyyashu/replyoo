export type PlanKey = 'free' | 'pro' | 'business'

export interface PlanLimits {
  contactsPerMonth: number
  connectedAccounts: number
  /** null = unlimited */
  liveAutomations: number | null
}

/** Launch numbers (spec §3.6). The worker enforces contacts; the web enforces accounts and live automations. */
export const PLAN_LIMITS: Record<PlanKey, PlanLimits> = {
  free: { contactsPerMonth: 1_000, connectedAccounts: 1, liveAutomations: 3 },
  pro: { contactsPerMonth: 5_000, connectedAccounts: 3, liveAutomations: null },
  business: { contactsPerMonth: 25_000, connectedAccounts: 10, liveAutomations: null },
}

/** `YYYY-MM` in UTC, the key of `usage_counters.period`. */
export function usagePeriod(date: Date): string {
  return date.toISOString().slice(0, 7)
}

/** First instant of the next UTC month: when a free plan's usage resets. */
export function periodEnd(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
}

export const PLAN_NAMES: Record<PlanKey, string> = { free: 'Free', pro: 'Pro', business: 'Business' }

/** How often a paid plan bills. Each (plan, interval) pair is one Dodo product. */
export const BILLING_INTERVALS = ['month', 'year'] as const
export type BillingInterval = (typeof BILLING_INTERVALS)[number]

/** Dodo subscription statuses that keep a paid plan's limits (`past_due` is the payment-retry grace period). */
export const PAID_STATUSES: readonly string[] = ['active', 'past_due']

export interface SubscriptionState {
  plan: PlanKey
  status: string
  currentPeriodEnd: Date | null
}

/**
 * The plan whose limits apply now. A lapsed paid subscription falls back to free; a cancelled one
 * keeps its plan until the period it already paid for ends.
 */
export function effectivePlan(subscription: SubscriptionState | null | undefined, now: Date): PlanKey {
  if (!subscription || subscription.plan === 'free') return 'free'
  if (PAID_STATUSES.includes(subscription.status)) return subscription.plan
  if (subscription.status === 'cancelled' && subscription.currentPeriodEnd && subscription.currentPeriodEnd > now) {
    return subscription.plan
  }
  return 'free'
}
