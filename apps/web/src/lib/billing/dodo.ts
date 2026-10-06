import 'server-only'
import { env } from '../env'

export type PaidPlan = 'pro' | 'business'

export interface DodoConfig {
  apiKey: string
  baseUrl: string
  /** Dodo product ID per paid plan. */
  products: Record<PaidPlan, string>
}

export const DODO_BASE_URLS = {
  test_mode: 'https://test.dodopayments.com',
  live_mode: 'https://live.dodopayments.com',
} as const

/** Null until the API key and both product IDs are set; billing UI and endpoints stay off until then. */
export function dodoConfig(): DodoConfig | null {
  const e = env()
  if (!e.DODO_API_KEY || !e.DODO_PRODUCT_PRO || !e.DODO_PRODUCT_BUSINESS) return null
  return {
    apiKey: e.DODO_API_KEY,
    baseUrl: DODO_BASE_URLS[e.DODO_ENVIRONMENT],
    products: { pro: e.DODO_PRODUCT_PRO, business: e.DODO_PRODUCT_BUSINESS },
  }
}

export function planForProduct(products: DodoConfig['products'], productId: string): PaidPlan | null {
  if (productId === products.pro) return 'pro'
  if (productId === products.business) return 'business'
  return null
}
