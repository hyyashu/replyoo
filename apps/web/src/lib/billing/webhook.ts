import { createHmac, timingSafeEqual } from 'node:crypto'

const TOLERANCE_SECONDS = 5 * 60

/**
 * Standard Webhooks (what Dodo Payments sends): HMAC-SHA256 over `${id}.${timestamp}.${body}` with the
 * base64 key after `whsec_`; the header may carry several space-separated `v1,<base64>` signatures.
 */
export function verifyStandardWebhook(secret: string, headers: Headers, body: string, now = new Date()): boolean {
  const id = headers.get('webhook-id')
  const timestamp = headers.get('webhook-timestamp')
  const signatures = headers.get('webhook-signature')
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return false
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest()
  return signatures.split(' ').some((entry) => {
    const [version, signature] = entry.split(',')
    if (version !== 'v1' || !signature) return false
    const given = Buffer.from(signature, 'base64')
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}
