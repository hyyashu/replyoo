import type { BillingInterval, PlanKey } from '@replyooo/shared'

/** One pricing card, ready to render; built on the server by planCards() in pricing.ts. */
export interface PlanCard {
  key: PlanKey
  name: string
  blurb: string
  perks: string[]
  featured: boolean
  /** Formatted price per month. */
  month: string
  /** Formatted price per year; null when yearly is unavailable. */
  year: string | null
  savePercent: number | null
}

/** Free is current regardless of interval; without yearly prices a yearly plan still counts as current. */
export function isCurrentCard(
  card: { key: PlanKey },
  current: { plan: PlanKey; interval: BillingInterval },
  shown: BillingInterval,
  yearly: boolean,
): boolean {
  if (card.key !== current.plan) return false
  return card.key === 'free' || !yearly || current.interval === shown
}
