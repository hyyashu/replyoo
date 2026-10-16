// Pieces both platform adapters share. Internal: not exported from the package.
import { graphRequest } from './graph'
import { toGraphMessage } from './messages'
import type { AccountCredentials, PlatformAdapter } from './types'

export type GraphCall = <T>(
  account: AccountCredentials,
  path: string,
  init?: { method?: 'GET' | 'POST' | 'DELETE'; query?: Record<string, string>; body?: unknown },
) => Promise<T>

/** A Graph API caller bound to one host and version, authenticated as the account. */
export function graphCaller(baseUrl: string): GraphCall {
  return (account, path, init = {}) => graphRequest({ baseUrl, path, token: account.accessToken, ...init })
}

/** Instagram and Messenger take a private reply the same way: a message addressed to the comment. */
export function privateReplySender(call: GraphCall): PlatformAdapter['sendPrivateReply'] {
  return async (account, commentId, message) => {
    const res = await call<{ message_id?: string }>(account, `${account.externalId}/messages`, {
      method: 'POST',
      body: { recipient: { comment_id: commentId }, message: toGraphMessage(message) },
    })
    return { messageId: res.message_id ?? null }
  }
}

/** The cursor for the next page, only when Meta says there is one. */
export function nextCursor(paging: { cursors?: { after?: string }; next?: string } | undefined): { next?: string } {
  const after = paging?.next ? paging.cursors?.after : undefined
  return after ? { next: after } : {}
}
