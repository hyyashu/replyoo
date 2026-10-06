import { subscriptions } from '@replyooo/db'
import { eq } from 'drizzle-orm'
import { createHmac, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { POST } from '@/app/api/webhooks/dodo/route'
import { applyDodoEvent } from '@/lib/billing/sync'
import { verifyStandardWebhook } from '@/lib/billing/webhook'
import { getSubscription } from '@/lib/data/workspace'
import { db } from '@/lib/db'
import { createWorkspace } from './support'

const SECRET = `whsec_${Buffer.from('dodo-test-signing-key').toString('base64')}`
const PRODUCTS = { pro: 'pdt_pro', business: 'pdt_business' }
// Unique per run: the test database is shared, and the webhook falls back to a customer-id lookup.
const CUSTOMER = `cus_${randomUUID()}`

process.env.DODO_API_KEY = 'dodo_test_key'
process.env.DODO_WEBHOOK_SECRET = SECRET
process.env.DODO_PRODUCT_PRO = PRODUCTS.pro
process.env.DODO_PRODUCT_BUSINESS = PRODUCTS.business

function sign(body: string, id = `msg_${randomUUID()}`, timestamp = Math.floor(Date.now() / 1000)) {
  const key = Buffer.from(SECRET.slice('whsec_'.length), 'base64')
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
  return new Headers({ 'webhook-id': id, 'webhook-timestamp': String(timestamp), 'webhook-signature': `v1,${signature}` })
}

function event(
  type: string,
  timestamp: string,
  data: Partial<{ subscription_id: string; product_id: string; status: string; customer_id: string; next_billing_date: string | null; workspace_id: string }>,
) {
  return {
    business_id: 'bus_1',
    type,
    timestamp,
    data: {
      payload_type: 'Subscription',
      subscription_id: data.subscription_id ?? `sub_${randomUUID()}`,
      product_id: data.product_id ?? PRODUCTS.pro,
      status: data.status ?? 'active',
      customer: { customer_id: data.customer_id ?? CUSTOMER, email: 'owner@example.com', name: 'Owner' },
      next_billing_date: data.next_billing_date === undefined ? '2026-11-06T10:00:00.000Z' : data.next_billing_date,
      metadata: data.workspace_id ? { workspace_id: data.workspace_id } : {},
    },
  }
}

async function row(workspaceId: string) {
  const [subscription] = await db().select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId))
  return subscription
}

describe('verifyStandardWebhook', () => {
  it('accepts a valid signature among several and rejects tampering, old timestamps and wrong secrets', () => {
    const body = '{"type":"subscription.active"}'
    const headers = sign(body)
    expect(verifyStandardWebhook(SECRET, headers, body)).toBe(true)

    const many = new Headers(headers)
    many.set('webhook-signature', `v1,AAAA ${headers.get('webhook-signature')}`)
    expect(verifyStandardWebhook(SECRET, many, body)).toBe(true)

    expect(verifyStandardWebhook(SECRET, headers, `${body} `)).toBe(false)
    expect(verifyStandardWebhook(`whsec_${Buffer.from('other').toString('base64')}`, headers, body)).toBe(false)
    const old = sign(body, 'msg_old', Math.floor(Date.now() / 1000) - 600)
    expect(verifyStandardWebhook(SECRET, old, body)).toBe(false)
    expect(verifyStandardWebhook(SECRET, new Headers(), body)).toBe(false)
  })
})

describe('applyDodoEvent', () => {
  it('activates the plan from checkout metadata', async () => {
    const { workspaceId } = await createWorkspace('Buyer')
    const result = await applyDodoEvent(db(), PRODUCTS, event('subscription.active', '2026-10-06T10:00:00.000Z', { workspace_id: workspaceId, subscription_id: `sub_${workspaceId}` }))
    expect(result).toBe('updated')
    expect(await row(workspaceId)).toMatchObject({
      plan: 'pro',
      status: 'active',
      dodoCustomerId: CUSTOMER,
      dodoSubscriptionId: `sub_${workspaceId}`,
      currentPeriodEnd: new Date('2026-11-06T10:00:00.000Z'),
    })
  })

  it('ignores an event older than the stored one', async () => {
    const { workspaceId } = await createWorkspace('Ordered')
    const sub = `sub_${workspaceId}`
    await applyDodoEvent(db(), PRODUCTS, event('subscription.renewed', '2026-10-06T10:00:00.000Z', { workspace_id: workspaceId, subscription_id: sub }))
    expect(
      await applyDodoEvent(db(), PRODUCTS, event('subscription.on_hold', '2026-10-05T10:00:00.000Z', { workspace_id: workspaceId, subscription_id: sub, status: 'on_hold' })),
    ).toBe('stale')
    expect(await row(workspaceId)).toMatchObject({ status: 'active' })
  })

  it('re-applies a duplicate delivery idempotently and lets an equal-timestamp event through, but not an older one', async () => {
    const { workspaceId } = await createWorkspace('Duplicate')
    const sub = `sub_${workspaceId}`
    const renewed = event('subscription.renewed', '2026-10-06T10:00:00.000Z', { workspace_id: workspaceId, subscription_id: sub })
    expect(await applyDodoEvent(db(), PRODUCTS, renewed)).toBe('updated')
    const { updatedAt: _first, ...first } = (await row(workspaceId))!
    expect(await applyDodoEvent(db(), PRODUCTS, renewed)).toBe('updated')
    expect(await row(workspaceId)).toMatchObject(first)
    expect(
      await applyDodoEvent(db(), PRODUCTS, event('subscription.on_hold', '2026-10-06T09:59:59.999Z', { subscription_id: sub, status: 'on_hold' })),
    ).toBe('stale')
    expect(await row(workspaceId)).toMatchObject({ status: 'active', dodoEventAt: new Date('2026-10-06T10:00:00.000Z') })
  })

  it('doesn’t guess between workspaces that share a Dodo customer', async () => {
    const customer = `cus_${randomUUID()}`
    const a = await createWorkspace('Shared A')
    const b = await createWorkspace('Shared B')
    await applyDodoEvent(db(), PRODUCTS, event('subscription.active', '2026-10-06T10:00:00.000Z', { workspace_id: a.workspaceId, subscription_id: `sub_${a.workspaceId}`, customer_id: customer }))
    await applyDodoEvent(db(), PRODUCTS, event('subscription.active', '2026-10-06T10:00:00.000Z', { workspace_id: b.workspaceId, subscription_id: `sub_${b.workspaceId}`, customer_id: customer }))
    expect(
      await applyDodoEvent(db(), PRODUCTS, event('subscription.active', '2026-10-07T10:00:00.000Z', { subscription_id: `sub_${randomUUID()}`, customer_id: customer, product_id: PRODUCTS.business })),
    ).toBe('unknown_workspace')
    expect(await row(a.workspaceId)).toMatchObject({ plan: 'pro', dodoSubscriptionId: `sub_${a.workspaceId}` })
    expect(await row(b.workspaceId)).toMatchObject({ plan: 'pro', dodoSubscriptionId: `sub_${b.workspaceId}` })
  })

  it('finds the workspace by subscription id when metadata is missing, and follows plan changes', async () => {
    const { workspaceId } = await createWorkspace('Upgrader')
    const sub = `sub_${workspaceId}`
    await applyDodoEvent(db(), PRODUCTS, event('subscription.active', '2026-10-06T10:00:00.000Z', { workspace_id: workspaceId, subscription_id: sub }))
    await applyDodoEvent(db(), PRODUCTS, event('subscription.plan_changed', '2026-10-07T10:00:00.000Z', { subscription_id: sub, product_id: PRODUCTS.business }))
    expect(await row(workspaceId)).toMatchObject({ plan: 'business' })
  })

  it('a lapsed payment drops the limits to free', async () => {
    const { workspaceId } = await createWorkspace('Lapse')
    const sub = `sub_${workspaceId}`
    await applyDodoEvent(db(), PRODUCTS, event('subscription.active', '2026-10-06T10:00:00.000Z', { workspace_id: workspaceId, subscription_id: sub }))
    await applyDodoEvent(db(), PRODUCTS, event('subscription.on_hold', '2026-10-08T10:00:00.000Z', { subscription_id: sub, status: 'on_hold' }))
    expect(await getSubscription(workspaceId, new Date('2026-10-08T12:00:00.000Z'))).toMatchObject({ plan: 'free', billedPlan: 'pro' })
  })

  it('an old subscription’s cancellation doesn’t override the newer active one', async () => {
    const { workspaceId } = await createWorkspace('Resubscriber')
    await applyDodoEvent(db(), PRODUCTS, event('subscription.active', '2026-10-06T10:00:00.000Z', { workspace_id: workspaceId, subscription_id: `new_${workspaceId}` }))
    expect(
      await applyDodoEvent(
        db(),
        PRODUCTS,
        event('subscription.cancelled', '2026-10-07T10:00:00.000Z', { workspace_id: workspaceId, subscription_id: `old_${workspaceId}`, status: 'cancelled' }),
      ),
    ).toBe('stale')
    expect(await row(workspaceId)).toMatchObject({ status: 'active', dodoSubscriptionId: `new_${workspaceId}` })
  })

  it('reports what it couldn’t apply', async () => {
    const { workspaceId } = await createWorkspace('Odd')
    expect(await applyDodoEvent(db(), PRODUCTS, event('subscription.active', '2026-10-06T10:00:00.000Z', { workspace_id: workspaceId, product_id: 'pdt_unknown' }))).toBe('unknown_product')
    expect(await applyDodoEvent(db(), PRODUCTS, event('subscription.active', '2026-10-06T10:00:00.000Z', { subscription_id: `sub_${randomUUID()}`, customer_id: `cus_${randomUUID()}` }))).toBe('unknown_workspace')
    expect(await applyDodoEvent(db(), PRODUCTS, { type: 'payment.succeeded', timestamp: '2026-10-06T10:00:00.000Z', data: { payload_type: 'Payment' } })).toBe('ignored')
  })
})

describe('POST /api/webhooks/dodo', () => {
  it('rejects a bad signature and applies a good one', async () => {
    const { workspaceId } = await createWorkspace('Route')
    const body = JSON.stringify(event('subscription.active', new Date().toISOString(), { workspace_id: workspaceId, subscription_id: `sub_${workspaceId}` }))

    const forged = await POST(new Request('http://localhost:3000/api/webhooks/dodo', { method: 'POST', body, headers: sign('{}') }))
    expect(forged.status).toBe(401)
    expect(await row(workspaceId)).toBeUndefined()

    const response = await POST(new Request('http://localhost:3000/api/webhooks/dodo', { method: 'POST', body, headers: sign(body) }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true, result: 'updated' })
    expect(await row(workspaceId)).toMatchObject({ plan: 'pro' })
  })

  it('answers malformed signed payloads without crashing', async () => {
    const { workspaceId } = await createWorkspace('Malformed')
    const notJson = '{not json'
    expect((await POST(new Request('http://localhost:3217/api/webhooks/dodo', { method: 'POST', body: notJson, headers: sign(notJson) }))).status).toBe(400)

    const badDate = JSON.stringify(event('subscription.active', new Date().toISOString(), { workspace_id: workspaceId, next_billing_date: 'soon' }))
    const response = await POST(new Request('http://localhost:3217/api/webhooks/dodo', { method: 'POST', body: badDate, headers: sign(badDate) }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true, result: 'ignored' })
    expect(await row(workspaceId)).toBeUndefined()
  })
})
