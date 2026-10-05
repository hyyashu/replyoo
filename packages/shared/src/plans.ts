export type PlanKey = 'free' | 'pro' | 'business'

export interface PlanLimits {
  contactsPerMonth: number
  connectedAccounts: number
  /** null = unlimited */
  liveAutomations: number | null
}

/** Launch numbers (spec §3.6). Enforcement lands with billing in Plan 4. */
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
