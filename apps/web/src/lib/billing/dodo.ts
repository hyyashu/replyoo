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

export class DodoError extends Error {
  override name = 'DodoError'
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function post<T>(config: DodoConfig, path: string, init: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
  const url = new URL(path, config.baseUrl)
  for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (cause) {
    throw new DodoError(`Dodo request failed: ${(cause as Error).message}`, 0)
  }
  const body = (await response.json().catch(() => ({}))) as { message?: string }
  if (!response.ok) {
    throw new DodoError(`Dodo POST ${path} failed (${response.status}): ${body.message ?? response.statusText}`, response.status)
  }
  return body as T
}

/** A hosted checkout for a new subscription. The workspace id rides along as metadata for the webhook. */
export async function createCheckout(
  config: DodoConfig,
  input: {
    productId: string
    workspaceId: string
    customer: { customerId: string } | { email: string; name: string }
    returnUrl: string
  },
): Promise<string> {
  const customer = 'customerId' in input.customer
    ? { customer_id: input.customer.customerId }
    : { email: input.customer.email, name: input.customer.name }
  const session = await post<{ checkout_url?: string | null }>(config, '/checkouts', {
    body: {
      product_cart: [{ product_id: input.productId, quantity: 1 }],
      customer,
      return_url: input.returnUrl,
      metadata: { workspace_id: input.workspaceId },
    },
  })
  if (!session.checkout_url) throw new DodoError('Dodo returned no checkout URL', 200)
  return session.checkout_url
}

/** Moves an existing subscription to another product. Returns a payment link when the change needs one. */
export async function changeSubscriptionPlan(config: DodoConfig, subscriptionId: string, productId: string): Promise<string | null> {
  const result = await post<{ payment_link?: string | null }>(config, `/subscriptions/${encodeURIComponent(subscriptionId)}/change-plan`, {
    body: { product_id: productId, quantity: 1, proration_billing_mode: 'prorated_immediately' },
  })
  return result.payment_link ?? null
}

/** Dodo's hosted customer portal: payment method, invoices, cancellation. */
export async function createPortalSession(config: DodoConfig, customerId: string, returnUrl: string): Promise<string> {
  const result = await post<{ link: string }>(config, `/customers/${encodeURIComponent(customerId)}/customer-portal/session`, {
    query: { return_url: returnUrl },
  })
  return result.link
}
