import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createFacebookAdapter } from '../src'
import { FB_PAGE, fb } from './fixtures'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const base = 'https://graph.facebook.com/v24.0'
const account = { externalId: FB_PAGE, accessToken: 'EAAG' }
const adapter = createFacebookAdapter()

function capture(method: 'get' | 'post' | 'delete', url: string, response: Record<string, unknown>) {
  const calls: { body: unknown; search: URLSearchParams }[] = []
  server.use(
    http[method](url, async ({ request }) => {
      const text = await request.text()
      calls.push({ body: text ? JSON.parse(text) : null, search: new URL(request.url).searchParams })
      return HttpResponse.json(response)
    }),
  )
  return calls
}

describe('createFacebookAdapter', () => {
  it('normalizes Page webhooks and has no follow check', () => {
    expect(adapter.platform).toBe('facebook')
    expect(adapter.normalizeWebhook(fb.comment)).toHaveLength(1)
    expect(adapter.isFollower).toBeUndefined()
  })

  it('sends DMs as RESPONSE messages', async () => {
    const calls = capture('post', `${base}/${FB_PAGE}/messages`, { recipient_id: 'psid_1', message_id: 'm_out' })
    expect(await adapter.sendMessage(account, 'psid_1', { kind: 'text', text: 'Hi' })).toEqual({ messageId: 'm_out' })
    expect(calls[0]?.body).toEqual({ recipient: { id: 'psid_1' }, messaging_type: 'RESPONSE', message: { text: 'Hi' } })
  })

  it('sends private replies', async () => {
    const calls = capture('post', `${base}/${FB_PAGE}/messages`, { message_id: 'm_pr' })
    await adapter.sendPrivateReply(account, '104_c1', { kind: 'text', text: 'Hi' })
    expect(calls[0]?.body).toEqual({ recipient: { comment_id: '104_c1' }, message: { text: 'Hi' } })
  })

  it('replies publicly to comments', async () => {
    const calls = capture('post', `${base}/104_c1/comments`, { id: '104_c1_r' })
    expect(await adapter.replyToComment(account, '104_c1', 'Sent!')).toEqual({ messageId: '104_c1_r' })
    expect(calls[0]?.body).toEqual({ message: 'Sent!' })
  })

  it('reads profiles and post time', async () => {
    capture('get', `${base}/psid_1`, { name: 'Priya Sharma', profile_pic: 'https://pic' })
    capture('get', `${base}/104_p1`, { created_time: '2026-10-01T09:00:00+0000' })
    expect(await adapter.getProfile(account, 'psid_1')).toEqual({
      name: 'Priya Sharma',
      username: null,
      avatarUrl: 'https://pic',
    })
    expect((await adapter.getMediaPublishedAt(account, '104_p1'))?.toISOString()).toBe('2026-10-01T09:00:00.000Z')
  })

  it('lists recent page posts', async () => {
    capture('get', `${base}/${FB_PAGE}/posts`, {
      data: [{ id: `${FB_PAGE}_p1`, message: 'Sale', full_picture: 'https://pic', permalink_url: 'https://fb/p1', created_time: '2026-10-01T09:00:00+0000' }],
    })
    expect(await adapter.listMedia(account)).toEqual([
      { id: `${FB_PAGE}_p1`, caption: 'Sale', thumbnailUrl: 'https://pic', permalink: 'https://fb/p1', publishedAt: new Date('2026-10-01T09:00:00Z') },
    ])
  })

  it('sets and clears ice breakers', async () => {
    const posts = capture('post', `${base}/me/messenger_profile`, { result: 'success' })
    await adapter.setIceBreakers(account, [{ question: 'Hours?', payload: 'ib:a1:0' }])
    expect(posts[0]?.body).toEqual({
      ice_breakers: [{ locale: 'default', call_to_actions: [{ question: 'Hours?', payload: 'ib:a1:0' }] }],
    })
    const deletes = capture('delete', `${base}/me/messenger_profile`, { result: 'success' })
    await adapter.setIceBreakers(account, [])
    expect(deletes[0]?.body).toEqual({ fields: ['ice_breakers'] })
  })

  it('subscribes the Page', async () => {
    const calls = capture('post', `${base}/${FB_PAGE}/subscribed_apps`, { success: true })
    await adapter.subscribeWebhooks(account)
    expect(calls[0]?.search.get('subscribed_fields')).toBe('messages,messaging_postbacks,feed')
  })

  it('keeps non-expiring Page tokens', async () => {
    expect(await adapter.refreshToken(account)).toEqual({ accessToken: 'EAAG', expiresAt: null })
  })
})
