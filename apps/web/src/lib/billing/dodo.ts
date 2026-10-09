import 'server-only'
import { BILLING_INTERVALS, type BillingInterval } from '@replyooo/shared'
import { type Env, env } from '../env'

export type PaidPlan = 'pro' | 'business'
export interface PlanChoice {
  plan: PaidPlan
  interval: BillingInterval
}
/** One Dodo subscription product per (plan, interval). */
export type ProductTable = Record<PaidPlan, Record<BillingInterval, string>>

export interface DodoConfig {
  apiKey: string
  baseUrl: string
  products: ProductTable
}

export const DODO_BASE_URLS = {
  test_mode: 'https://test.dodopayments.com',
  live_mode: 'https://live.dodopayments.com',
} as const

/** Null until the API key and all four product IDs are set; billing UI and endpoints stay off until then. */
export function dodoConfig(e: Env = env()): DodoConfig | null {
  const { DODO_API_KEY: apiKey, DODO_PRODUCT_PRO_MONTHLY: proMonth, DODO_PRODUCT_PRO_YEARLY: proYear } = e
  const { DODO_PRODUCT_BUSINESS_MONTHLY: businessMonth, DODO_PRODUCT_BUSINESS_YEARLY: businessYear } = e
  if (!apiKey || !proMonth || !proYear || !businessMonth || !businessYear) return null
  return {
    apiKey,
    baseUrl: DODO_BASE_URLS[e.DODO_ENVIRONMENT],
    products: { pro: { month: proMonth, year: proYear }, business: { month: businessMonth, year: businessYear } },
  }
}

const CHOICES: readonly PlanChoice[] = (['pro', 'business'] as const).flatMap((plan) => BILLING_INTERVALS.map((interval) => ({ plan, interval })))

export function productFor(products: ProductTable, choice: PlanChoice): string {
  return products[choice.plan][choice.interval]
}

export function productIds(products: ProductTable): string[] {
  return CHOICES.map((choice) => productFor(products, choice))
}

export function planForProduct(products: ProductTable, productId: string): PlanChoice | null {
  const choice = CHOICES.find((c) => productFor(products, c) === productId)
  return choice ? { ...choice } : null
}

/** Form values from the billing UI; a missing interval means monthly. */
export function parsePlanChoice(plan: unknown, interval: unknown): PlanChoice | null {
  if (plan !== 'pro' && plan !== 'business') return null
  const value = interval ?? 'month'
  if (value !== 'month' && value !== 'year') return null
  return { plan, interval: value }
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

/** One Dodo API call. Errors (network, non-2xx) become DodoError. */
export async function dodoRequest<T>(
  config: Pick<DodoConfig, 'apiKey' | 'baseUrl'>,
  method: 'GET' | 'POST',
  path: string,
  init: { query?: Record<string, string>; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const url = new URL(path, config.baseUrl)
  for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value)
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
    })
  } catch (cause) {
    throw new DodoError(`Dodo request failed: ${(cause as Error).message}`, 0)
  }
  const body = (await response.json().catch(() => ({}))) as { message?: string }
  if (!response.ok) {
    throw new DodoError(`Dodo ${method} ${path} failed (${response.status}): ${body.message ?? response.statusText}`, response.status)
  }
  return body as T
}

const post = <T>(config: DodoConfig, path: string, init: { query?: Record<string, string>; body?: unknown } = {}) =>
  dodoRequest<T>(config, 'POST', path, init)

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
