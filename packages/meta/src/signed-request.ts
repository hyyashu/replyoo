import { createHmac, timingSafeEqual } from 'node:crypto'

export interface SignedRequest {
  /** App-scoped ID of the person who removed the app or asked for deletion. */
  userId: string
  issuedAt: number | null
}

/**
 * Meta's deauthorize and data-deletion callbacks post `signed_request`:
 * `<base64url HMAC-SHA256(payload segment, app secret)>.<base64url JSON>`. Returns null unless the
 * signature matches and the payload names HMAC-SHA256 and a user.
 */
export function parseSignedRequest(signedRequest: string, appSecret: string): SignedRequest | null {
  const [encodedSignature, encodedPayload, ...rest] = signedRequest.split('.')
  if (!encodedSignature || !encodedPayload || rest.length > 0) return null
  const expected = createHmac('sha256', appSecret).update(encodedPayload).digest()
  const given = Buffer.from(encodedSignature, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  let payload: { algorithm?: unknown; user_id?: unknown; issued_at?: unknown }
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (payload === null || typeof payload !== 'object') return null
  if (typeof payload.algorithm !== 'string' || payload.algorithm.toUpperCase() !== 'HMAC-SHA256') return null
  if (typeof payload.user_id !== 'string' && typeof payload.user_id !== 'number') return null
  return { userId: String(payload.user_id), issuedAt: typeof payload.issued_at === 'number' ? payload.issued_at : null }
}
