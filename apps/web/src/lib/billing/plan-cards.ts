import type { PlanKey } from '@replyooo/shared'

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
