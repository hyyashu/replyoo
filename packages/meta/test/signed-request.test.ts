import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseSignedRequest } from '../src/signed-request'

function sign(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(body).digest('base64url')
  return `${signature}.${body}`
}

describe('parseSignedRequest', () => {
  it('returns the user for a request signed with the app secret', () => {
    expect(parseSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: '1234', issued_at: 1_790_000_000 }, 'app-secret'), 'app-secret')).toEqual({
      userId: '1234',
      issuedAt: 1_790_000_000,
    })
    expect(parseSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: 98765 }, 'app-secret'), 'app-secret')).toEqual({ userId: '98765', issuedAt: null })
  })

  it('rejects other secrets, tampering, other algorithms and garbage', () => {
    const good = sign({ algorithm: 'HMAC-SHA256', user_id: '1234' }, 'app-secret')
    expect(parseSignedRequest(good, 'other-secret')).toBeNull()
    const [signature] = good.split('.')
    const forged = `${signature}.${Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '9999' })).toString('base64url')}`
    expect(parseSignedRequest(forged, 'app-secret')).toBeNull()
    expect(parseSignedRequest(sign({ algorithm: 'none', user_id: '1234' }, 'app-secret'), 'app-secret')).toBeNull()
    expect(parseSignedRequest(sign({ algorithm: 'HMAC-SHA256' }, 'app-secret'), 'app-secret')).toBeNull()
    expect(parseSignedRequest('not-a-signed-request', 'app-secret')).toBeNull()
    expect(parseSignedRequest('', 'app-secret')).toBeNull()
  })
})
