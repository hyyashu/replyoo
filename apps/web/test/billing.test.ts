import { subscriptions } from '@replyooo/db'
import { http, HttpResponse, type JsonBodyType } from 'msw'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { startPlanChange } from '@/lib/billing/checkout'
import { createPortalSession, DodoError, type DodoConfig } from '@/lib/billing/dodo'
import { db } from '@/lib/db'
import { createWorkspace, mockFetch } from './support'

const server = mockFetch()
beforeEach(() => server.reset())
afterAll(() => server.restore())

const DODO = 'https://test.dodopayments.com'
const config: DodoConfig = { apiKey: 'dodo_key', baseUrl: DODO, products: { pro: 'pdt_pro', business: 'pdt_business' } }
const RETURN = 'http://localhost:3000/settings?billing=updated#billing'

function capture(method: 'post', path: string, response: JsonBodyType) {
  const calls: { url: string; auth: string | null; body: unknown }[] = []
  server.use(
    http[method](`${DODO}${path}`, async ({ request }) => {
      const text = await request.text()
      calls.push({ url: request.url, auth: request.headers.get('authorization'), body: text ? JSON.parse(text) : null })
      return HttpResponse.json(response)
    }),
  )
  return calls
}

async function owner(name: string) {
  const { workspaceId, user } = await createWorkspace(name)
  return { workspaceId, user: { email: user.email, name: user.name } }
}

describe('startPlanChange', () => {
  it('starts a checkout for a workspace without a paid subscription', async () => {
    const workspace = await owner('Checkout')
    const calls = capture('post', '/checkouts', { session_id: 'cks_1', checkout_url: 'https://checkout.dodopayments.com/cks_1' })

    expect(await startPlanChange(config, workspace, 'pro')).toBe('https://checkout.dodopayments.com/cks_1')
    expect(calls).toEqual([
      {
        url: `${DODO}/checkouts`,
        auth: 'Bearer dodo_key',
        body: {
          product_cart: [{ product_id: 'pdt_pro', quantity: 1 }],
          customer: { email: workspace.user.email, name: workspace.user.name },
          return_url: RETURN,
          metadata: { workspace_id: workspace.workspaceId },
        },
      },
    ])
  })

  it('reuses the Dodo customer of a lapsed subscription', async () => {
    const workspace = await owner('Returning')
    await db().insert(subscriptions).values({ workspaceId: workspace.workspaceId, plan: 'pro', status: 'expired', dodoCustomerId: 'cus_9', dodoSubscriptionId: 'sub_9' })
    const calls = capture('post', '/checkouts', { session_id: 'cks_2', checkout_url: 'https://checkout.dodopayments.com/cks_2' })

    await startPlanChange(config, workspace, 'business')
    expect(calls[0]?.body).toMatchObject({ customer: { customer_id: 'cus_9' }, product_cart: [{ product_id: 'pdt_business', quantity: 1 }] })
  })

  it('changes an active subscription in place', async () => {
    const workspace = await owner('Upgrade')
    await db().insert(subscriptions).values({ workspaceId: workspace.workspaceId, plan: 'pro', status: 'active', dodoCustomerId: 'cus_1', dodoSubscriptionId: 'sub_1' })
    const calls = capture('post', '/subscriptions/sub_1/change-plan', { payment_link: null })

    expect(await startPlanChange(config, workspace, 'business')).toBe(RETURN)
    expect(calls[0]?.body).toEqual({ product_id: 'pdt_business', quantity: 1, proration_billing_mode: 'prorated_immediately' })
  })

  it('sends the customer to Dodo when the change needs a payment', async () => {
    const workspace = await owner('PayDiff')
    await db().insert(subscriptions).values({ workspaceId: workspace.workspaceId, plan: 'pro', status: 'active', dodoCustomerId: 'cus_2', dodoSubscriptionId: 'sub_2' })
    capture('post', '/subscriptions/sub_2/change-plan', { payment_link: 'https://checkout.dodopayments.com/pay_1' })
    expect(await startPlanChange(config, workspace, 'business')).toBe('https://checkout.dodopayments.com/pay_1')
  })

  it('does nothing for the plan the workspace already pays for', async () => {
    const workspace = await owner('Same')
    await db().insert(subscriptions).values({ workspaceId: workspace.workspaceId, plan: 'pro', status: 'active', dodoCustomerId: 'cus_3', dodoSubscriptionId: 'sub_3' })
    expect(await startPlanChange(config, workspace, 'pro')).toBe(RETURN)
  })
})

describe('createPortalSession', () => {
  it('returns the portal link with our return URL', async () => {
    const calls = capture('post', '/customers/cus_1/customer-portal/session', { link: 'https://customer.dodopayments.com/s_1' })
    expect(await createPortalSession(config, 'cus_1', 'http://localhost:3000/settings#billing')).toBe('https://customer.dodopayments.com/s_1')
    expect(new URL(calls[0]?.url ?? '').searchParams.get('return_url')).toBe('http://localhost:3000/settings#billing')
  })

  it('turns Dodo errors into DodoError', async () => {
    server.use(http.post(`${DODO}/customers/cus_x/customer-portal/session`, () => HttpResponse.json({ message: 'Customer not found' }, { status: 404 })))
    const error = await createPortalSession(config, 'cus_x', 'http://localhost:3000/settings').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DodoError)
    expect(error).toMatchObject({ status: 404, message: 'Dodo POST /customers/cus_x/customer-portal/session failed (404): Customer not found' })
  })
})
