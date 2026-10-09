import { http, HttpResponse } from 'msw'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { checkoutCountryFields, fetchProductPricing } from '@/lib/billing/dodo-catalog'
import { DodoError } from '@/lib/billing/dodo'
import { mockFetch } from './support'

const DODO = 'https://test.dodopayments.com'
const config = { apiKey: 'dodo_key', baseUrl: DODO }
const server = mockFetch()
beforeEach(() => server.reset())
afterAll(() => server.restore())

const product = (overrides: Record<string, unknown> = {}) => ({
  product_id: 'pdt_pro',
  pricing_mode: null,
  price: { type: 'recurring_price', price: 1200, currency: 'USD', payment_frequency_interval: 'Month', subscription_period_interval: 'Year', payment_frequency_count: 1, subscription_period_count: 10, discount: 0, purchasing_power_parity: false },
  ...overrides,
})

describe('fetchProductPricing', () => {
  it('reads the base price and skips localized prices for a base-only product', async () => {
    const auth: (string | null)[] = []
    server.use(http.get(`${DODO}/products/pdt_pro`, ({ request }) => {
      auth.push(request.headers.get('authorization'))
      return HttpResponse.json(product())
    }))
    expect(await fetchProductPricing(config, 'pdt_pro')).toEqual({ base: { amount: 1200, currency: 'USD' }, mode: null, byCountry: {} })
    expect(auth).toEqual(['Bearer dodo_key'])
  })

  it('collects by_country rules keyed by upper-case country code', async () => {
    server.use(
      http.get(`${DODO}/products/pdt_pro`, () => HttpResponse.json(product({ pricing_mode: 'by_country' }))),
      http.get(`${DODO}/products/pdt_pro/localized-prices`, () =>
        HttpResponse.json({
          items: [
            { id: 'lp_1', product_id: 'pdt_pro', mode: 'by_country', currency: 'INR', amount: 99900, country_code: 'IN', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' },
            { id: 'lp_2', product_id: 'pdt_pro', mode: 'by_currency', currency: 'EUR', amount: 1100, country_code: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' },
          ],
        }),
      ),
    )
    expect(await fetchProductPricing(config, 'pdt_pro')).toEqual({
      base: { amount: 1200, currency: 'USD' },
      mode: 'by_country',
      byCountry: { IN: { amount: 99900, currency: 'INR' } },
    })
  })

  it('turns an unexpected product shape into DodoError', async () => {
    server.use(http.get(`${DODO}/products/pdt_pro`, () => HttpResponse.json({ price: { type: 'recurring_price' } })))
    await expect(fetchProductPricing(config, 'pdt_pro')).rejects.toBeInstanceOf(DodoError)
  })

  it('turns HTTP errors into DodoError with the method in the message', async () => {
    server.use(http.get(`${DODO}/products/pdt_x`, () => HttpResponse.json({ message: 'Not found' }, { status: 404 })))
    await expect(fetchProductPricing(config, 'pdt_x')).rejects.toMatchObject({ status: 404, message: 'Dodo GET /products/pdt_x failed (404): Not found' })
  })
})

describe('checkoutCountryFields', () => {
  it('passes the country as the billing country and nothing when unknown', () => {
    expect(checkoutCountryFields('IN')).toEqual({ billing_address: { country: 'IN' } })
    expect(checkoutCountryFields(null)).toEqual({})
  })
})
