import 'server-only'
import { FALLBACK_MONTHLY_USD_CENTS, PLAN_CATALOG } from '../plans'
import { type DodoConfig, type PaidPlan, dodoConfig, productFor, productIds } from './dodo'
import { type Money, type ProductPricing, fetchProductPricing } from './dodo-catalog'
import type { PlanCard } from './plan-cards'

export type { Money } from './dodo-catalog'
export type { PlanCard } from './plan-cards'
export { isCurrentCard } from './plan-cards'

const TTL_MS = 60 * 60 * 1000
const RETRY_MS = 60 * 1000
const PAID: readonly PaidPlan[] = ['pro', 'business']
/** Cloudflare's values for "unknown" and "Tor". */
const NO_COUNTRY = new Set(['XX', 'T1'])

/** Visitor country from Cloudflare, or null for base (USD) prices. */
export function requestCountry(headers: { get(name: string): string | null }): string | null {
  const value = headers.get('cf-ipcountry')?.trim().toUpperCase()
  if (!value || !/^[A-Z]{2}$/.test(value) || NO_COUNTRY.has(value)) return null
  return value
}

/** Only by_country rules are honoured; by_currency products show their base price. */
export function selectPrice(pricing: ProductPricing, country: string | null): Money {
  if (pricing.mode === 'by_country' && country) return pricing.byCountry[country] ?? pricing.base
  return pricing.base
}

function fractionDigits(currency: string): number {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
}

export function formatMoney(money: Money): string {
  const digits = fractionDigits(money.currency)
  const value = money.amount / 10 ** digits
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: money.currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(value)
}

/** Whole percent saved by paying yearly, rounded down; null unless both prices share a currency and yearly is cheaper. */
export function yearlySavingsPercent(month: Money, year: Money): number | null {
  if (month.currency !== year.currency || month.amount <= 0) return null
  // Integer maths: (1 - 0.8) * 100 in floating point is 19.999…, which would floor to 19.
  const twelve = 12 * month.amount
  const percent = Math.floor(((twelve - year.amount) * 100) / twelve)
  return percent > 0 ? percent : null
}

export interface PaidPlanPrices {
  month: Money
  year: Money | null
  savePercent: number | null
}
export interface DisplayPrices {
  source: 'dodo' | 'fallback'
  /** False when yearly prices are unknown: hide the toggle. */
  yearly: boolean
  plans: Record<PaidPlan, PaidPlanPrices>
}

type Catalog = Map<string, ProductPricing>
let cache: { key: string; catalog: Catalog; fetchedAt: number } | null = null
let retryAt = 0
let inflight: Promise<Catalog | null> | null = null

export function resetPriceCache(): void {
  cache = null
  retryAt = 0
  inflight = null
}

async function loadCatalog(config: DodoConfig, now: number): Promise<Catalog | null> {
  const ids = productIds(config.products)
  const key = ids.join(',')
  const usable = cache?.key === key ? cache : null
  if (usable && now - usable.fetchedAt < TTL_MS) return usable.catalog
  if (now < retryAt) return usable?.catalog ?? null
  inflight ??= (async () => {
    try {
      const entries = await Promise.all(ids.map(async (id) => [id, await fetchProductPricing(config, id)] as const))
      cache = { key, catalog: new Map(entries), fetchedAt: now }
      retryAt = 0
      return cache.catalog
    } catch (error) {
      console.error('dodo prices unavailable; serving cached or fallback prices', error)
      retryAt = now + RETRY_MS
      return usable?.catalog ?? null
    } finally {
      inflight = null
    }
  })()
  return inflight
}

function fallbackPrices(): DisplayPrices {
  const plan = (key: PaidPlan): PaidPlanPrices => ({ month: { amount: FALLBACK_MONTHLY_USD_CENTS[key], currency: 'USD' }, year: null, savePercent: null })
  return { source: 'fallback', yearly: false, plans: { pro: plan('pro'), business: plan('business') } }
}

/** Never throws: any Dodo problem yields cached or fallback prices. */
export async function displayPrices(country: string | null, config: DodoConfig | null = dodoConfig(), now = Date.now()): Promise<DisplayPrices> {
  if (!config) return fallbackPrices()
  const catalog = await loadCatalog(config, now)
  if (!catalog) return fallbackPrices()
  const price = (plan: PaidPlan, interval: 'month' | 'year') => {
    const pricing = catalog.get(productFor(config.products, { plan, interval }))
    if (!pricing) throw new Error('price catalog is missing a configured product')
    return selectPrice(pricing, country)
  }
  const plans = Object.fromEntries(
    PAID.map((plan) => {
      const month = price(plan, 'month')
      const year = price(plan, 'year')
      return [plan, { month, year, savePercent: yearlySavingsPercent(month, year) }]
    }),
  ) as Record<PaidPlan, PaidPlanPrices>
  return { source: 'dodo', yearly: true, plans }
}

/** Plan copy from PLAN_CATALOG with prices from `prices`. Free shows zero in the Pro monthly currency. */
export function planCards(prices: DisplayPrices): PlanCard[] {
  const zero = formatMoney({ amount: 0, currency: prices.plans.pro.month.currency })
  return PLAN_CATALOG.map(({ key, name, blurb, perks, featured }) => {
    if (key === 'free') return { key, name, blurb, perks, featured, month: zero, year: prices.yearly ? zero : null, savePercent: null }
    const p = prices.plans[key]
    return { key, name, blurb, perks, featured, month: formatMoney(p.month), year: p.year ? formatMoney(p.year) : null, savePercent: p.savePercent }
  })
}

/** "Save 16%" when both plans save the same, "Save up to 17%" otherwise, null when nothing to show. */
export function saveLabel(prices: DisplayPrices): string | null {
  if (!prices.yearly) return null
  const percents = PAID.map((plan) => prices.plans[plan].savePercent).filter((p): p is number => p !== null)
  if (percents.length === 0) return null
  const max = Math.max(...percents)
  return percents.length === PAID.length && percents.every((p) => p === max) ? `Save ${max}%` : `Save up to ${max}%`
}
