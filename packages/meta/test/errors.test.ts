import { describe, expect, it } from 'vitest'
import { classifyGraphError, MetaError, retryAfterFromHeaders } from '../src'

const body = (code: number, error_subcode?: number, message = 'Graph says no') => ({
  error: { message, type: 'OAuthException', code, error_subcode },
})

describe('classifyGraphError', () => {
  it.each([
    [400, body(190), 'reauth', 'token_invalid'],
    [400, body(190, 460), 'reauth', 'token_invalid'],
    [400, body(190, 463), 'reauth', 'token_invalid'],
    [400, body(102), 'reauth', 'token_invalid'],
    [400, body(463), 'reauth', 'token_invalid'],
    [400, body(467), 'reauth', 'token_invalid'],
    [400, body(10, 2018278), 'permanent', 'window_closed'],
    [400, body(10, 2534022), 'permanent', 'window_closed'],
    [400, body(551), 'permanent', 'user_unavailable'],
    [400, body(100, 2018001), 'permanent', 'user_unavailable'],
    [400, body(4), 'retryable', 'rate_limited'],
    [400, body(17), 'retryable', 'rate_limited'],
    [400, body(32), 'retryable', 'rate_limited'],
    [400, body(613), 'retryable', 'rate_limited'],
    [400, body(80000), 'retryable', 'rate_limited'],
    [400, body(80006), 'retryable', 'rate_limited'],
    [400, body(80014), 'retryable', 'rate_limited'],
    [429, null, 'retryable', 'rate_limited'],
    // Recipient- or feature-specific refusals fail the message without disconnecting the account.
    [403, body(10), 'permanent', 'permission'],
    [403, body(200), 'permanent', 'permission'],
    [400, body(230, undefined, 'Requires pages_messaging permission to manage the object'), 'reauth', 'permission'],
    [403, body(10, undefined, 'Application does not have permission for this action'), 'reauth', 'permission'],
    [403, body(200, undefined, 'The user has not authorized application 123'), 'reauth', 'permission'],
    [403, body(200, undefined, 'Permissions error'), 'permanent', 'permission'],
    [403, body(10, undefined, 'The user does not have permission to message this person'), 'permanent', 'permission'],
    [403, body(10, undefined, 'User is missing required permission'), 'permanent', 'permission'],
    [403, body(200, undefined, 'This person does not have permissions enabled'), 'permanent', 'permission'],
    [403, body(200, undefined, 'App has been removed'), 'reauth', 'permission'],
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

  it('keeps the back-off on rate limits only', () => {
    expect(classifyGraphError(400, body(4), { retryAfterMs: 60_000 }).details.retryAfterMs).toBe(60_000)
    expect(classifyGraphError(400, body(100), { retryAfterMs: 60_000 }).details.retryAfterMs).toBeUndefined()
  })

  it('keeps the Graph message', () => {
    expect(classifyGraphError(400, body(100)).message).toBe('Graph says no')
    expect(classifyGraphError(502, null).message).toMatch(/502/)
  })
})

describe('retryAfterFromHeaders', () => {
  it('reads Retry-After seconds and dates', () => {
    expect(retryAfterFromHeaders(new Headers({ 'retry-after': '30' }))).toBe(30_000)
    expect(retryAfterFromHeaders(new Headers({ 'retry-after': new Date(10_000).toUTCString() }), 0)).toBe(10_000)
  })

  it('takes the longest business use case wait', () => {
    const usage = { a: [{ estimated_time_to_regain_access: 2 }], b: [{ estimated_time_to_regain_access: 5 }, { estimated_time_to_regain_access: 0 }] }
    expect(retryAfterFromHeaders(new Headers({ 'x-business-use-case-usage': JSON.stringify(usage) }))).toBe(5 * 60_000)
  })

  it('ignores missing, zero and malformed values', () => {
    expect(retryAfterFromHeaders(new Headers())).toBeUndefined()
    expect(retryAfterFromHeaders(new Headers({ 'x-business-use-case-usage': '{nope', 'retry-after': '0' }))).toBeUndefined()
  })
})
