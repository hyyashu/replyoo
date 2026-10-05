import { describe, expect, it } from 'vitest'
import { classifyGraphError, MetaError } from '../src'

const body = (code: number, error_subcode?: number) => ({
  error: { message: 'Graph says no', type: 'OAuthException', code, error_subcode },
})

describe('classifyGraphError', () => {
  it.each([
    [400, body(190), 'reauth', 'token_invalid'],
    [400, body(190, 460), 'reauth', 'token_invalid'],
    [400, body(10, 2018278), 'permanent', 'window_closed'],
    [400, body(10, 2534022), 'permanent', 'window_closed'],
    [400, body(551), 'permanent', 'user_unavailable'],
    [400, body(100, 2018001), 'permanent', 'user_unavailable'],
    [400, body(4), 'retryable', 'rate_limited'],
    [400, body(17), 'retryable', 'rate_limited'],
    [400, body(32), 'retryable', 'rate_limited'],
    [400, body(613), 'retryable', 'rate_limited'],
    [429, null, 'retryable', 'rate_limited'],
    [403, body(10), 'reauth', 'permission'],
    [403, body(200), 'reauth', 'permission'],
    [500, body(2), 'retryable', 'server'],
    [503, null, 'retryable', 'server'],
    [400, body(100), 'permanent', 'invalid_request'],
    [400, 'not json', 'permanent', 'invalid_request'],
  ] as const)('status %i %j → %s/%s', (status, payload, kind, reason) => {
    const error = classifyGraphError(status, payload)
    expect(error).toBeInstanceOf(MetaError)
    expect(error.kind).toBe(kind)
    expect(error.details.reason).toBe(reason)
    expect(error.details.status).toBe(status)
  })

  it('keeps the Graph message', () => {
    expect(classifyGraphError(400, body(100)).message).toBe('Graph says no')
    expect(classifyGraphError(502, null).message).toMatch(/502/)
  })
})
