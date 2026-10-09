import 'server-only'
import { z } from 'zod'
import { type DodoConfig, DodoError, dodoRequest } from './dodo'

/*
 * Everything that depends on Dodo's product/localized-price response shapes and on the checkout field that carries the
 * billing country lives in this file. Checked against docs.dodopayments.com on 2026-10-09 (Task 0):
 *   GET /products/{id}                      → price.price (minor units), price.currency, pricing_mode (null | by_currency | by_country)
 *   GET /products/{id}/localized-prices     → { items: [{ mode, currency, amount (minor units), country_code }] }
 *                                             (the item field is `mode`; `pricing_mode` exists only on the product and is nullable)
 *   POST /checkouts                         → billing_address.country (alpha-2) selects the by_country price
 * The list endpoint returns active rules only; a duplicate country is resolved last-one-wins.
 * Zero-decimal currencies (JPY, KRW): docs are silent, amounts are treated as the currency's smallest unit.
 * If Dodo differs, correct this file and test/dodo-catalog.test.ts only.
 */

export interface Money {
  /** Minor units of `currency` (cents, paise; whole yen for JPY). */
  amount: number
  currency: string
}
export type PricingMode = 'by_country' | 'by_currency' | null
export interface ProductPricing {
  base: Money
  mode: PricingMode
  /** by_country rules, keyed by upper-case ISO 3166-1 alpha-2 code. */
  byCountry: Record<string, Money>
}

const Mode = z.enum(['by_country', 'by_currency'])
const Product = z.object({
  pricing_mode: Mode.nullish(),
  price: z.object({ price: z.number().int().nonnegative(), currency: z.string().length(3) }),
})
const LocalizedPrices = z.object({
  items: z.array(
    z.object({ mode: Mode, currency: z.string().length(3), amount: z.number().int().nonnegative(), country_code: z.string().length(2).nullish() }),
  ),
})

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new DodoError(`Unexpected Dodo ${what} response`, 200)
  return result.data
}

export async function fetchProductPricing(config: Pick<DodoConfig, 'apiKey' | 'baseUrl'>, productId: string, timeoutMs = 3_000): Promise<ProductPricing> {
  const id = encodeURIComponent(productId)
  const product = parse(Product, await dodoRequest(config, 'GET', `/products/${id}`, { timeoutMs }), 'product')
  const base = { amount: product.price.price, currency: product.price.currency.toUpperCase() }
  const mode = product.pricing_mode ?? null
  const byCountry: Record<string, Money> = {}
  if (mode === 'by_country') {
    const list = parse(LocalizedPrices, await dodoRequest(config, 'GET', `/products/${id}/localized-prices`, { timeoutMs }), 'localized prices')
    for (const item of list.items) {
      if (item.mode === 'by_country' && item.country_code) {
        byCountry[item.country_code.toUpperCase()] = { amount: item.amount, currency: item.currency.toUpperCase() }
      }
    }
  }
  return { base, mode, byCountry }
}

/** Extra POST /checkouts fields that make Dodo charge the visitor's country price. */
export function checkoutCountryFields(country: string | null): Record<string, unknown> {
  return country ? { billing_address: { country } } : {}
}
