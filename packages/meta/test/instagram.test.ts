import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createInstagramAdapter, MetaError } from '../src'
import { IG_ACCOUNT, ig } from './fixtures'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const base = 'https://graph.instagram.com/v24.0'
const account = { externalId: IG_ACCOUNT, accessToken: 'IGAAT' }
const adapter = createInstagramAdapter()

function capture(method: 'get' | 'post' | 'delete', url: string, response: unknown) {
  const calls: { body: unknown; search: URLSearchParams; auth: string | null }[] = []
  server.use(
    http[method](url, async ({ request }) => {
      const text = await request.text()
      calls.push({
        body: text ? JSON.parse(text) : null,
        search: new URL(request.url).searchParams,
        auth: request.headers.get('authorization'),
      })
      return HttpResponse.json(response as Record<string, unknown>)
    }),
  )
  return calls
}

describe('createInstagramAdapter', () => {
  it('normalizes Instagram webhooks', () => {
    expect(adapter.platform).toBe('instagram')
    expect(adapter.normalizeWebhook(ig.dm)).toHaveLength(1)
  })

  it('sends DMs', async () => {
    const calls = capture('post', `${base}/${IG_ACCOUNT}/messages`, { recipient_id: 'igsid_1', message_id: 'mid.out' })
    const result = await adapter.sendMessage(account, 'igsid_1', { kind: 'text', text: 'Hi' })
    expect(result).toEqual({ messageId: 'mid.out' })
    expect(calls[0]?.body).toEqual({ recipient: { id: 'igsid_1' }, message: { text: 'Hi' } })
    expect(calls[0]?.auth).toBe('Bearer IGAAT')
  })

  it('reads the account profile', async () => {
    const calls = capture('get', `${base}/me`, { name: 'Acme', profile_picture_url: 'https://pic', followers_count: 42 })
    expect(await adapter.getAccountProfile(account)).toEqual({ displayName: 'Acme', avatarUrl: 'https://pic', followersCount: 42 })
    expect(calls[0]?.search.get('fields')).toBe('name,profile_picture_url,followers_count')
  })

  it('sends private replies to a comment', async () => {
    const calls = capture('post', `${base}/${IG_ACCOUNT}/messages`, { message_id: 'mid.pr' })
    await adapter.sendPrivateReply(account, 'c1', {
      kind: 'text',
      text: 'Tap below',
      buttons: [{ type: 'postback', label: 'Send it', payload: 'r:run:s1:b1' }],
    })
    expect(calls[0]?.body).toMatchObject({
      recipient: { comment_id: 'c1' },
      message: { attachment: { type: 'template' } },
    })
  })

  it('replies publicly to comments', async () => {
    const calls = capture('post', `${base}/c1/replies`, { id: 'c1_reply' })
    expect(await adapter.replyToComment(account, 'c1', 'Check your DMs!')).toEqual({ messageId: 'c1_reply' })
    expect(calls[0]?.body).toEqual({ message: 'Check your DMs!' })
  })

  it('reads profiles, follow status and media time', async () => {
    server.use(
      http.get(`${base}/igsid_1`, ({ request }) => {
        const fields = new URL(request.url).searchParams.get('fields')
        if (fields === 'is_user_follow_business') return HttpResponse.json({ is_user_follow_business: true })
        return HttpResponse.json({
          name: 'Priya Sharma',
          username: 'priya',
          profile_pic: 'https://pic',
          is_user_follow_business: true,
          is_business_follow_user: false,
        })
      }),
      http.get(`${base}/media1`, () => HttpResponse.json({ timestamp: '2026-10-01T09:00:00+0000' })),
    )
    expect(await adapter.getProfile(account, 'igsid_1')).toEqual({
      name: 'Priya Sharma',
      username: 'priya',
      avatarUrl: 'https://pic',
      followsYou: true,
      youFollow: false,
    })
    expect(await adapter.isFollower?.(account, 'igsid_1')).toBe(true)
    expect((await adapter.getMediaPublishedAt(account, 'media1'))?.toISOString()).toBe('2026-10-01T09:00:00.000Z')
  })

  it('lists recent media with a still for videos', async () => {
    const calls = capture('get', `${base}/${IG_ACCOUNT}/media`, {
      data: [
        { id: 'm1', caption: 'Hi', media_type: 'IMAGE', media_url: 'https://img', permalink: 'https://ig/p/1', timestamp: '2026-10-01T09:00:00+0000' },
        { id: 'm2', media_type: 'VIDEO', media_url: 'https://video.mp4', thumbnail_url: 'https://still' },
      ],
    })
    const media = await adapter.listMedia(account, 2)
    expect(calls[0]?.search.get('limit')).toBe('2')
    expect(media).toEqual([
      { id: 'm1', caption: 'Hi', thumbnailUrl: 'https://img', permalink: 'https://ig/p/1', publishedAt: new Date('2026-10-01T09:00:00Z') },
      { id: 'm2', caption: null, thumbnailUrl: 'https://still', permalink: null, publishedAt: null },
    ])
  })

  it('sets and clears ice breakers', async () => {
    const posts = capture('post', `${base}/${IG_ACCOUNT}/messenger_profile`, { result: 'success' })
    await adapter.setIceBreakers(account, [{ question: 'Pricing?', payload: 'ib:a1:0' }])
    expect(posts[0]?.body).toEqual({
      platform: 'instagram',
      ice_breakers: [{ locale: 'default', call_to_actions: [{ question: 'Pricing?', payload: 'ib:a1:0' }] }],
    })
    const deletes = capture('delete', `${base}/${IG_ACCOUNT}/messenger_profile`, { result: 'success' })
    await adapter.setIceBreakers(account, [])
    expect(deletes[0]?.body).toEqual({ platform: 'instagram', fields: ['ice_breakers'] })
  })

  it('subscribes to webhooks', async () => {
    const calls = capture('post', `${base}/${IG_ACCOUNT}/subscribed_apps`, { success: true })
    await adapter.subscribeWebhooks(account)
    expect(calls[0]?.search.get('subscribed_fields')).toBe('comments,messages,messaging_postbacks')
  })

  it('refreshes long-lived tokens', async () => {
    const calls = capture('get', 'https://graph.instagram.com/refresh_access_token', {
      access_token: 'IGAAT-new',
      token_type: 'bearer',
      expires_in: 5184000,
    })
    const before = Date.now()
    const result = await adapter.refreshToken(account)
    expect(result.accessToken).toBe('IGAAT-new')
    expect(result.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 5184000 * 1000)
    expect(calls[0]?.search.get('grant_type')).toBe('ig_refresh_token')
    expect(calls[0]?.search.get('access_token')).toBe('IGAAT')
  })

  it('surfaces Graph errors as MetaError', async () => {
    server.use(
      http.post(`${base}/${IG_ACCOUNT}/messages`, () =>
        HttpResponse.json({ error: { message: 'Outside window', code: 10, error_subcode: 2534022 } }, { status: 400 }),
      ),
    )
    const error = await adapter.sendMessage(account, 'igsid_1', { kind: 'text', text: 'Hi' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MetaError)
    expect((error as MetaError).details.reason).toBe('window_closed')
  })
})
