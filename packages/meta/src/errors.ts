export type MetaErrorKind = 'retryable' | 'reauth' | 'permanent'

export type MetaFailureReason =
  | 'window_closed'
  | 'user_unavailable'
  | 'rate_limited'
  | 'token_invalid'
  | 'permission'
  | 'invalid_request'
  | 'server'
  | 'network'
  /** A POST timed out: Meta may or may not have acted on it, so it must not be retried. */
  | 'timeout_ambiguous'

export interface MetaErrorDetails {
  status?: number
  code?: number
  subcode?: number
  reason?: MetaFailureReason
  /** For rate limits: how long Meta asked us to back off (Retry-After or estimated_time_to_regain_access). */
  retryAfterMs?: number
}

export class MetaError extends Error {
  constructor(
    readonly kind: MetaErrorKind,
    message: string,
    readonly details: MetaErrorDetails = {},
  ) {
    super(message)
    this.name = 'MetaError'
  }
}

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number }
}

/** Token expired, revoked or invalidated (password change, logout, app removal). */
const TOKEN_CODES = new Set([102, 190, 463, 467])
const WINDOW_SUBCODES = new Set([2018278, 2534022])
const USER_UNAVAILABLE_SUBCODES = new Set([2018001, 2534014])
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613])
/** Business use case rate limits (Instagram/Messenger platform throttling). */
const isBusinessRateLimit = (code: number) => code >= 80000 && code <= 80014
/**
 * Code 10 and 200-299 cover both account-wide problems (a permission not granted, the app removed) and refusals
 * about one recipient or feature (their privacy settings, a thread the feature is not enabled for). Graph's codes
 * do not tell them apart, its message does: only these wordings ask for a reconnect.
 */
const ACCOUNT_PERMISSION_MESSAGE =
  /((does not have|requires?|missing)\b[^.]*\bpermissions?|permissions? (has|have) not been granted|not authori[sz]ed (the )?app|has not authori[sz]ed|deauthori[sz]ed|app (was|has been) removed)/i

export function classifyGraphError(status: number, body: unknown, opts: { retryAfterMs?: number } = {}): MetaError {
  const error =
    body !== null && typeof body === 'object' ? ((body as GraphErrorBody).error ?? {}) : {}
  const { code, error_subcode: subcode } = error
  const message = error.message ?? `Graph API request failed with status ${status}`
  const make = (kind: MetaErrorKind, reason: MetaFailureReason) =>
    new MetaError(kind, message, { status, code, subcode, reason })

  if (code !== undefined && TOKEN_CODES.has(code)) return make('reauth', 'token_invalid')
  if (subcode !== undefined && WINDOW_SUBCODES.has(subcode)) return make('permanent', 'window_closed')
  if (code === 551 || (subcode !== undefined && USER_UNAVAILABLE_SUBCODES.has(subcode))) {
    return make('permanent', 'user_unavailable')
  }
  if (status === 429 || (code !== undefined && (RATE_LIMIT_CODES.has(code) || isBusinessRateLimit(code)))) {
    return new MetaError('retryable', message, {
      status,
      code,
      subcode,
      reason: 'rate_limited',
      ...(opts.retryAfterMs !== undefined ? { retryAfterMs: opts.retryAfterMs } : {}),
    })
  }
  if (code === 10 || (code !== undefined && code >= 200 && code <= 299)) {
    // Anything else is about this recipient or this feature: fail the message, keep the account connected.
    return make(ACCOUNT_PERMISSION_MESSAGE.test(message) ? 'reauth' : 'permanent', 'permission')
  }
  if (status >= 500 || code === 1 || code === 2) return make('retryable', 'server')
  return make('permanent', 'invalid_request')
}

/**
 * How long Meta asks us to wait, from Retry-After (seconds or a date) or the largest
 * estimated_time_to_regain_access (minutes) in x-business-use-case-usage. Undefined when neither says.
 */
export function retryAfterFromHeaders(headers: Headers, now = Date.now()): number | undefined {
  const candidates: number[] = []
  const retryAfter = headers.get('retry-after')
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds)) candidates.push(seconds * 1000)
    else {
      const at = Date.parse(retryAfter)
      if (!Number.isNaN(at)) candidates.push(at - now)
    }
  }
  const usage = headers.get('x-business-use-case-usage')
  if (usage) {
    try {
      const parsed = JSON.parse(usage) as Record<string, Array<{ estimated_time_to_regain_access?: number }>>
      for (const entries of Object.values(parsed)) {
        for (const entry of Array.isArray(entries) ? entries : []) {
          const minutes = entry?.estimated_time_to_regain_access
          if (typeof minutes === 'number' && minutes > 0) candidates.push(minutes * 60_000)
        }
      }
    } catch {
      // A malformed header is no reason to fail the request's error handling.
    }
  }
  const positive = candidates.filter((ms) => ms > 0)
  return positive.length > 0 ? Math.max(...positive) : undefined
}
