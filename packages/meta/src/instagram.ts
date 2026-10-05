import { GRAPH_API_VERSION, graphRequest } from './graph'
import { toGraphMessage } from './messages'
import { normalizeInstagramWebhook } from './normalize'
import type { AccountCredentials, PlatformAdapter } from './types'

const HOST = 'https://graph.instagram.com'

export function createInstagramAdapter(options: { graphVersion?: string } = {}): PlatformAdapter {
  const baseUrl = `${HOST}/${options.graphVersion ?? GRAPH_API_VERSION}`
  const call = <T>(
    account: AccountCredentials,
    path: string,
    init: { method?: 'GET' | 'POST' | 'DELETE'; query?: Record<string, string>; body?: unknown } = {},
  ) => graphRequest<T>({ baseUrl, path, token: account.accessToken, ...init })

  return {
    platform: 'instagram',
    normalizeWebhook: normalizeInstagramWebhook,

    async sendMessage(account, recipientId, message) {
      const res = await call<{ message_id?: string }>(account, `${account.externalId}/messages`, {
        method: 'POST',
        body: { recipient: { id: recipientId }, message: toGraphMessage(message) },
      })
      return { messageId: res.message_id ?? null }
    },

    async sendPrivateReply(account, commentId, message) {
      const res = await call<{ message_id?: string }>(account, `${account.externalId}/messages`, {
        method: 'POST',
        body: { recipient: { comment_id: commentId }, message: toGraphMessage(message) },
      })
      return { messageId: res.message_id ?? null }
    },

    async replyToComment(account, commentId, text) {
      const res = await call<{ id?: string }>(account, `${commentId}/replies`, {
        method: 'POST',
        body: { message: text },
      })
      return { messageId: res.id ?? null }
    },

    async getProfile(account, userId) {
      const res = await call<{ name?: string; username?: string; profile_pic?: string }>(account, userId, {
        query: { fields: 'name,username,profile_pic' },
      })
      return { name: res.name ?? null, username: res.username ?? null, avatarUrl: res.profile_pic ?? null }
    },

    async getMediaPublishedAt(account, mediaId) {
      const res = await call<{ timestamp?: string }>(account, mediaId, { query: { fields: 'timestamp' } })
      return res.timestamp ? new Date(res.timestamp) : null
    },

    async isFollower(account, userId) {
      const res = await call<{ is_user_follow_business?: boolean }>(account, userId, {
        query: { fields: 'is_user_follow_business' },
      })
      return res.is_user_follow_business === true
    },

    async setIceBreakers(account, items) {
      const path = `${account.externalId}/messenger_profile`
      if (items.length === 0) {
        await call(account, path, { method: 'DELETE', body: { platform: 'instagram', fields: ['ice_breakers'] } })
        return
      }
      await call(account, path, {
        method: 'POST',
        body: {
          platform: 'instagram',
          ice_breakers: [
            { locale: 'default', call_to_actions: items.map((i) => ({ question: i.question, payload: i.payload })) },
          ],
        },
      })
    },

    async subscribeWebhooks(account) {
      await call(account, `${account.externalId}/subscribed_apps`, {
        method: 'POST',
        query: { subscribed_fields: 'comments,messages,messaging_postbacks' },
      })
    },

    async refreshToken(account) {
      const res = await graphRequest<{ access_token: string; expires_in: number }>({
        baseUrl: HOST,
        path: 'refresh_access_token',
        token: account.accessToken,
        query: { grant_type: 'ig_refresh_token', access_token: account.accessToken },
      })
      return { accessToken: res.access_token, expiresAt: new Date(Date.now() + res.expires_in * 1000) }
    },
  }
}
