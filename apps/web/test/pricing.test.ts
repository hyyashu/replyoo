import { http, HttpResponse } from 'msw'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DodoConfig } from '@/lib/billing/dodo'
import {
  displayPrices, formatMoney, isCurrentCard, planCards, requestCountry, resetPriceCache, saveLabel, selectPrice, yearlySavingsPercent,
} from '@/lib/billing/pricing'
import { switchInterval } from '@/lib/billing/plan-cards'
import { mockFetch } from './support'

const DODO = 'https://test.dodopayments.com'
const config: DodoConfig = {
  apiKey: 'dodo_key',
  baseUrl: DODO,
  products: { pro: { month: 'pdt_pm', year: 'pdt_py' }, business: { month: 'pdt_bm', year: 'pdt_by' } },
}
const HOUR = 60 * 60 * 1000
const server = mockFetch()
afterAll(() => server.restore())

type Rule = { country: string; amount: number; currency: string }
const PRODUCTS: Record<string, { amount: number; rules: Rule[] }> = {
  pdt_pm: { amount: 1200, rules: [{ country: 'IN', amount: 99900, currency: 'INR' }] },
  pdt_py: { amount: 12000, rules: [{ country: 'IN', amount: 999900, currency: 'INR' }] },
  pdt_bm: { amount: 2900, rules: [] },
  pdt_by: { amount: 29000, rules: [] },
}
let calls = 0
function dodoUp() {
  server.use(
    http.get(`${DODO}/products/:id`, ({ params }) => {
      calls++
      const p = PRODUCTS[String(params.id)]
      if (!p) return HttpResponse.json({ message: 'nope' }, { status: 404 })
      return HttpResponse.json({ pricing_mode: p.rules.length ? 'by_country' : null, price: { type: 'recurring_price', price: p.amount, currency: 'USD' } })
    }),
    http.get(`${DODO}/products/:id/localized-prices`, ({ params }) =>
      HttpResponse.json({ items: (PRODUCTS[String(params.id)]?.rules ?? []).map((r, i) => ({ id: `lp_${i}`, product_id: params.id, mode: 'by_country', currency: r.currency, amount: r.amount, country_code: r.country, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' })) }),
    ),
  )
}
function dodoDown() {
  server.use(http.get(`${DODO}/products/:id`, () => { calls++; return HttpResponse.json({ message: 'down' }, { status: 503 }) }))
}

beforeEach(() => {
  server.reset()
  resetPriceCache()
  calls = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('requestCountry', () => {
  it('reads CF-IPCountry and treats unknown values as no country', () => {
    expect(requestCountry(new Headers({ 'cf-ipcountry': 'in' }))).toBe('IN')
    for (const value of ['XX', 'T1', '', 'IND', '1N']) expect(requestCountry(new Headers({ 'cf-ipcountry': value }))).toBeNull()
    expect(requestCountry(new Headers())).toBeNull()
  })
})

describe('selectPrice', () => {
  const pricing = { base: { amount: 1200, currency: 'USD' }, mode: 'by_country' as const, byCountry: { IN: { amount: 99900, currency: 'INR' } } }
  it('uses the country rule, else the base price', () => {
    expect(selectPrice(pricing, 'IN')).toEqual({ amount: 99900, currency: 'INR' })
    expect(selectPrice(pricing, 'DE')).toEqual({ amount: 1200, currency: 'USD' })
    expect(selectPrice(pricing, null)).toEqual({ amount: 1200, currency: 'USD' })
  })
  it('ignores rules when the product is not in by_country mode', () => {
    expect(selectPrice({ ...pricing, mode: 'by_currency' }, 'IN')).toEqual({ amount: 1200, currency: 'USD' })
  })
})

describe('formatMoney', () => {
  it('formats minor units for two- and zero-decimal currencies', () => {
    expect(formatMoney({ amount: 1200, currency: 'USD' })).toBe('$12')
    expect(formatMoney({ amount: 1250, currency: 'USD' })).toBe('$12.50')
    expect(formatMoney({ amount: 99900, currency: 'INR' })).toBe('₹999')
    expect(formatMoney({ amount: 1200, currency: 'JPY' })).toBe('¥1,200')
  })
})

describe('yearlySavingsPercent', () => {
  it('rounds down the saving of a year against twelve months, without float error', () => {
    expect(yearlySavingsPercent({ amount: 1200, currency: 'USD' }, { amount: 12000, currency: 'USD' })).toBe(16)
    expect(yearlySavingsPercent({ amount: 1000, currency: 'USD' }, { amount: 9600, currency: 'USD' })).toBe(20)
  })
  it('ignores mismatched currencies and non-savings', () => {
    expect(yearlySavingsPercent({ amount: 99900, currency: 'INR' }, { amount: 12000, currency: 'USD' })).toBeNull()
    expect(yearlySavingsPercent({ amount: 1000, currency: 'USD' }, { amount: 12000, currency: 'USD' })).toBeNull()
  })
})

describe('displayPrices', () => {
  it('shows Dodo prices for the visitor’s country with yearly savings', async () => {
    dodoUp()
    const india = await displayPrices('IN', config, 0)
    expect(india).toMatchObject({ source: 'dodo', yearly: true })
    expect(india.plans.pro).toEqual({ month: { amount: 99900, currency: 'INR' }, year: { amount: 999900, currency: 'INR' }, savePercent: 16 })
    expect(india.plans.business.month).toEqual({ amount: 2900, currency: 'USD' })
    expect((await displayPrices(null, config, 0)).plans.pro.month).toEqual({ amount: 1200, currency: 'USD' })
  })

  it('caches for an hour', async () => {
    dodoUp()
    await displayPrices(null, config, 0)
    const first = calls
    await displayPrices(null, config, HOUR - 1)
    expect(calls).toBe(first)
    await displayPrices(null, config, HOUR + 1)
    expect(calls).toBe(first * 2)
  })

  it('serves stale prices when Dodo fails after expiry', async () => {
    dodoUp()
    await displayPrices(null, config, 0)
    server.reset()
    dodoDown()
    const stale = await displayPrices('IN', config, HOUR + 1)
    expect(stale).toMatchObject({ source: 'dodo', yearly: true })
    expect(stale.plans.pro.month).toEqual({ amount: 99900, currency: 'INR' })
  })

  it('falls back to USD monthly and hides yearly with no cache and Dodo down', async () => {
    dodoDown()
    expect(await displayPrices('IN', config, 0)).toEqual({
      source: 'fallback',
      yearly: false,
      plans: {
        pro: { month: { amount: 1200, currency: 'USD' }, year: null, savePercent: null },
        business: { month: { amount: 2900, currency: 'USD' }, year: null, savePercent: null },
      },
    })
  })

  it('does not refetch for a minute after a failure with no cache', async () => {
    dodoDown()
    await displayPrices(null, config, 0)
    const after = calls
    await displayPrices(null, config, 59_000)
    expect(calls).toBe(after)
    await displayPrices(null, config, 61_000)
    expect(calls).toBeGreaterThan(after)
  })

  it('falls back without calling Dodo when billing is not configured', async () => {
    expect(await displayPrices('IN', null, 0)).toMatchObject({ source: 'fallback', yearly: false })
    expect(calls).toBe(0)
  })
})

describe('planCards and saveLabel', () => {
  it('formats the three plans in the visitor’s currency', async () => {
    dodoUp()
    const prices = await displayPrices('IN', config, 0)
    const cards = planCards(prices)
    expect(cards.map((c) => [c.key, c.month, c.year, c.savePercent])).toEqual([
      ['free', '₹0', '₹0', null],
      ['pro', '₹999', '₹9,999', 16],
      ['business', '$29', '$290', 16],
    ])
    expect(saveLabel(prices)).toBe('Save 16%')
    expect(saveLabel(await displayPrices('IN', null, 0))).toBeNull()
  })
})

describe('isCurrentCard', () => {
  it('marks the plan and interval the workspace pays for', () => {
    const pro = { key: 'pro' as const }
    expect(isCurrentCard(pro, { plan: 'pro', interval: 'year' }, 'year', true)).toBe(true)
    expect(isCurrentCard(pro, { plan: 'pro', interval: 'year' }, 'month', true)).toBe(false)
    expect(isCurrentCard({ key: 'free' }, { plan: 'free', interval: 'month' }, 'year', true)).toBe(true)
  })
  it('keeps a yearly plan current when yearly prices are unavailable', () => {
    expect(isCurrentCard({ key: 'pro' }, { plan: 'pro', interval: 'year' }, 'month', false)).toBe(true)
  })
})

describe('switchInterval', () => {
  it('keeps a yearly subscriber on yearly when yearly prices are unavailable', () => {
    expect(switchInterval({ plan: 'pro', interval: 'year' }, false, 'month')).toBe('year')
  })
  it('uses month for monthly subscribers and free workspaces without yearly prices', () => {
    expect(switchInterval({ plan: 'pro', interval: 'month' }, false, 'month')).toBe('month')
    expect(switchInterval({ plan: 'free', interval: 'month' }, false, 'month')).toBe('month')
  })
  it('follows the toggle when yearly prices are available', () => {
    expect(switchInterval({ plan: 'pro', interval: 'month' }, true, 'year')).toBe('year')
    expect(switchInterval({ plan: 'pro', interval: 'year' }, true, 'month')).toBe('month')
  })
})
