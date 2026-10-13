import { GRAPH_API_VERSION, graphRequest } from './graph'
import { toGraphMessage } from './messages'
import { normalizeFacebookWebhook } from './normalize'
import type { AccountCredentials, PlatformAdapter } from './types'

export function createFacebookAdapter(options: { graphVersion?: string } = {}): PlatformAdapter {
  const baseUrl = `https://graph.facebook.com/${options.graphVersion ?? GRAPH_API_VERSION}`
  const call = <T>(
    account: AccountCredentials,
    path: string,
    init: { method?: 'GET' | 'POST' | 'DELETE'; query?: Record<string, string>; body?: unknown } = {},
  ) => graphRequest<T>({ baseUrl, path, token: account.accessToken, ...init })

  return {
    platform: 'facebook',
    normalizeWebhook: normalizeFacebookWebhook,

    async sendMessage(account, recipientId, message) {
      const res = await call<{ message_id?: string }>(account, `${account.externalId}/messages`, {
        method: 'POST',
        body: { recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: toGraphMessage(message) },
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
      const res = await call<{ id?: string }>(account, `${commentId}/comments`, {
        method: 'POST',
        body: { message: text },
      })
      return { messageId: res.id ?? null }
    },

    async getProfile(account, userId) {
      const res = await call<{ name?: string; profile_pic?: string }>(account, userId, {
        query: { fields: 'name,profile_pic' },
      })
      return { name: res.name ?? null, username: null, avatarUrl: res.profile_pic ?? null }
    },

    async getAccountProfile(account) {
      const res = await call<{ name?: string; followers_count?: number; picture?: { data?: { url?: string } } }>(
        account,
        account.externalId,
        { query: { fields: 'name,followers_count,picture{url}' } },
      )
      return {
        displayName: res.name ?? null,
        avatarUrl: res.picture?.data?.url ?? null,
        followersCount: res.followers_count ?? null,
      }
    },

    async getMediaPublishedAt(account, mediaId) {
      const res = await call<{ created_time?: string }>(account, mediaId, { query: { fields: 'created_time' } })
      return res.created_time ? new Date(res.created_time) : null
    },

    async listMedia(account, limit = 24) {
      const res = await call<{
        data?: { id: string; message?: string; full_picture?: string; permalink_url?: string; created_time?: string }[]
      }>(account, `${account.externalId}/posts`, {
        query: { fields: 'id,message,full_picture,permalink_url,created_time', limit: String(limit) },
      })
      return (res.data ?? []).map((p) => ({
        id: p.id,
        caption: p.message ?? null,
        thumbnailUrl: p.full_picture ?? null,
        permalink: p.permalink_url ?? null,
        publishedAt: p.created_time ? new Date(p.created_time) : null,
      }))
    },

    async listComments(account, mediaId, opts = {}) {
      const res = await call<{
        data?: { id: string; message?: string; created_time?: string; from?: { id?: string; name?: string } }[]
        paging?: { cursors?: { after?: string }; next?: string }
      }>(account, `${mediaId}/comments`, {
        query: {
          fields: 'id,message,created_time,from{id,name}',
          filter: 'toplevel',
          order: 'reverse_chronological',
          limit: '50',
          ...(opts.since ? { since: String(Math.floor(opts.since.getTime() / 1000)) } : {}),
          ...(opts.cursor ? { after: opts.cursor } : {}),
        },
      })
      const items = (res.data ?? []).flatMap((c) =>
        c.from?.id && c.created_time
          ? [
              {
                id: c.id,
                mediaId,
                text: c.message ?? '',
                createdAt: new Date(c.created_time),
                authorId: c.from.id,
                authorUsername: null,
                authorName: c.from.name ?? null,
              },
            ]
          : [],
      )
      const after = res.paging?.next ? res.paging.cursors?.after : undefined
      return { items, ...(after ? { next: after } : {}) }
    },

    async setIceBreakers(account, items) {
      if (items.length === 0) {
        await call(account, 'me/messenger_profile', { method: 'DELETE', body: { fields: ['ice_breakers'] } })
        return
      }
      await call(account, 'me/messenger_profile', {
        method: 'POST',
        body: {
          ice_breakers: [
            { locale: 'default', call_to_actions: items.map((i) => ({ question: i.question, payload: i.payload })) },
          ],
        },
      })
    },

    async subscribeWebhooks(account) {
      await call(account, `${account.externalId}/subscribed_apps`, {
        method: 'POST',
        query: { subscribed_fields: 'messages,messaging_postbacks,feed' },
      })
    },

    async refreshToken(account) {
      return { accessToken: account.accessToken, expiresAt: null }
    },
  }
}
