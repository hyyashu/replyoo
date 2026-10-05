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

export interface MetaErrorDetails {
  status?: number
  code?: number
  subcode?: number
  reason?: MetaFailureReason
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

const TOKEN_CODES = new Set([102, 190, 463, 467])
const WINDOW_SUBCODES = new Set([2018278, 2534022])
const USER_UNAVAILABLE_SUBCODES = new Set([2018001, 2534014])
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613])

export function classifyGraphError(status: number, body: unknown): MetaError {
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
  if (status === 429 || (code !== undefined && RATE_LIMIT_CODES.has(code))) return make('retryable', 'rate_limited')
  if (code === 10 || (code !== undefined && code >= 200 && code <= 299)) return make('reauth', 'permission')
  if (status >= 500 || code === 1 || code === 2) return make('retryable', 'server')
  return make('permanent', 'invalid_request')
}
