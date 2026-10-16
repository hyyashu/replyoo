import { MAX_TEAM_SEATS, PLAN_KEYS, PLAN_LIMITS, PLAN_NAMES, type PlanKey } from '@replyooo/shared'

export interface PlanDisplay {
  key: PlanKey
  name: string
  price: string
  blurb: string
  perks: string[]
  featured: boolean
}

const count = new Intl.NumberFormat('en-US')

/** USD monthly prices in cents, shown only when Dodo's prices are unavailable. Keep equal to the Dodo base prices. */
export const FALLBACK_MONTHLY_USD_CENTS: Record<'pro' | 'business', number> = { pro: 1200, business: 2900 }

const usd = (cents: number) => `$${cents / 100}`

const COPY: Record<PlanKey, { price: string; blurb: string; extras: string[]; featured: boolean }> = {
  free: { price: '$0', blurb: 'For trying it on your next reel.', extras: ['Comment & story automations', 'Replyooo branding'], featured: false },
  pro: { price: usd(FALLBACK_MONTHLY_USD_CENTS.pro), blurb: 'For creators who post every week and want the funnel.', extras: ['Follow gate & lead capture', 'No branding'], featured: true },
  business: { price: usd(FALLBACK_MONTHLY_USD_CENTS.business), blurb: 'For full-time creators, teams and brands.', extras: ['Priority support'], featured: false },
}

function limitPerks(key: PlanKey): string[] {
  const limits = PLAN_LIMITS[key]
  return [
    `${count.format(limits.contactsPerMonth)} contacts / month`,
    limits.connectedAccounts === 1 ? '1 connected account' : `${limits.connectedAccounts} connected accounts`,
    limits.liveAutomations === null ? 'Unlimited live automations' : `${limits.liveAutomations} live automations`,
    `Up to ${MAX_TEAM_SEATS} team seats, free`,
  ]
}

/** Plan copy and USD base prices for JSON-LD, comparison pages and the price fallback. Live prices come from Dodo (lib/billing/pricing.ts). */
export const PLAN_CATALOG: PlanDisplay[] = PLAN_KEYS.map((key) => ({
  key,
  name: PLAN_NAMES[key],
  price: COPY[key].price,
  blurb: COPY[key].blurb,
  perks: [...limitPerks(key), ...COPY[key].extras],
  featured: COPY[key].featured,
}))
