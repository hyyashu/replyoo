import { applyDodoEvent } from '@/lib/billing/sync'
import { dodoConfig } from '@/lib/billing/dodo'
import { verifyStandardWebhook } from '@/lib/billing/webhook'
import { db } from '@/lib/db'
import { env } from '@/lib/env'

/** Dodo Payments webhooks (spec §5.3). Signed; unknown events are acknowledged so Dodo stops retrying them. */
export async function POST(request: Request) {
  const secret = env().DODO_WEBHOOK_SECRET
  const config = dodoConfig()
  if (!secret || !config) return new Response('Billing is not configured', { status: 404 })
  const body = await request.text()
  if (!verifyStandardWebhook(secret, request.headers, body)) return new Response('Invalid signature', { status: 401 })
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }
  const result = await applyDodoEvent(db(), config.products, payload)
  if (result === 'unknown_product' || result === 'unknown_workspace') {
    console.warn('dodo webhook not applied', { result, id: request.headers.get('webhook-id') })
  }
  return Response.json({ received: true, result })
}
