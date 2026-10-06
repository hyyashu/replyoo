import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  exchangeFacebookCode,
  exchangeInstagramCode,
  facebookAuthorizeUrl,
  instagramAuthorizeUrl,
  MetaError,
} from '../src'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const NOW = new Date('2026-10-06T10:00:00.000Z')
const igApp = { appId: 'ig-app', appSecret: 'ig-secret', redirectUri: 'https://app.test/api/meta/oauth/instagram/callback' }
const fbApp = { appId: 'fb-app', appSecret: 'fb-secret', redirectUri: 'https://app.test/api/meta/oauth/facebook/callback' }

function instagramHappyPath(tokenResponse: unknown) {
  const form: URLSearchParams[] = []
  server.use(
    http.post('https://api.instagram.com/oauth/access_token', async ({ request }) => {
      form.push(new URLSearchParams(await request.text()))
      return HttpResponse.json(tokenResponse as Record<string, unknown>)
    }),
    http.get('https://graph.instagram.com/access_token', ({ request }) => {
      const url = new URL(request.url)
      expect(url.searchParams.get('grant_type')).toBe('ig_exchange_token')
      expect(url.searchParams.get('client_secret')).toBe('ig-secret')
      expect(url.searchParams.get('access_token')).toBe('IG_SHORT')
      return HttpResponse.json({ access_token: 'IG_LONG', token_type: 'bearer', expires_in: 5_184_000 })
    }),
    http.get('https://graph.instagram.com/v24.0/me', ({ request }) => {
      expect(request.headers.get('authorization')).toBe('Bearer IG_LONG')
      return HttpResponse.json({
        user_id: '17841400000000001',
        username: 'maya.makes',
        name: 'Maya Makes',
        profile_picture_url: 'https://cdn.test/maya.jpg',
        account_type: 'MEDIA_CREATOR',
        followers_count: 412000,
      })
    }),
  )
  return form
}

describe('Instagram Login', () => {
  it('builds the authorize URL with business scopes and state', () => {
    const url = new URL(instagramAuthorizeUrl(igApp, 'nonce-1'))
    expect(url.origin + url.pathname).toBe('https://www.instagram.com/oauth/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'ig-app',
      redirect_uri: igApp.redirectUri,
      response_type: 'code',
      scope: 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments',
      state: 'nonce-1',
    })
  })

  it('exchanges a code for a long-lived token and the professional profile', async () => {
    const form = instagramHappyPath({ data: [{ access_token: 'IG_SHORT', user_id: '1', permissions: 'x' }] })
    const connection = await exchangeInstagramCode(igApp, 'CODE#_', NOW)

    expect(Object.fromEntries(form[0] ?? [])).toEqual({
      client_id: 'ig-app',
      client_secret: 'ig-secret',
      grant_type: 'authorization_code',
      redirect_uri: igApp.redirectUri,
      code: 'CODE',
    })
    expect(connection).toEqual({
      externalId: '17841400000000001',
      username: 'maya.makes',
      displayName: 'Maya Makes',
      avatarUrl: 'https://cdn.test/maya.jpg',
      followersCount: 412000,
      accountType: 'MEDIA_CREATOR',
      accessToken: 'IG_LONG',
      expiresAt: new Date('2026-12-05T10:00:00.000Z'),
    })
  })

  it('accepts the older flat token response', async () => {
    instagramHappyPath({ access_token: 'IG_SHORT', user_id: 1 })
    expect((await exchangeInstagramCode(igApp, 'CODE', NOW)).accessToken).toBe('IG_LONG')
  })

  it('turns an invalid code into a permanent MetaError', async () => {
    server.use(
      http.post('https://api.instagram.com/oauth/access_token', () =>
        HttpResponse.json({ error_type: 'OAuthException', code: 400, error_message: 'Invalid authorization code' }, { status: 400 }),
      ),
    )
    const error = await exchangeInstagramCode(igApp, 'BAD', NOW).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MetaError)
    expect(error).toMatchObject({ kind: 'permanent', message: 'Invalid authorization code' })
  })
})

describe('Facebook Login for Business', () => {
  it('uses the configuration id when one is set, scopes otherwise', () => {
    const withConfig = new URL(facebookAuthorizeUrl(fbApp, 'nonce-2', 'cfg-9'))
    expect(withConfig.origin + withConfig.pathname).toBe('https://www.facebook.com/v24.0/dialog/oauth')
    expect(withConfig.searchParams.get('config_id')).toBe('cfg-9')
    expect(withConfig.searchParams.get('scope')).toBeNull()
    expect(withConfig.searchParams.get('state')).toBe('nonce-2')

    const withScopes = new URL(facebookAuthorizeUrl(fbApp, 'nonce-3'))
    expect(withScopes.searchParams.get('scope')).toBe(
      'pages_show_list,pages_messaging,pages_manage_metadata,pages_read_engagement,pages_manage_engagement',
    )
  })

  it('exchanges a code for page tokens of every granted Page', async () => {
    server.use(
      http.get('https://graph.facebook.com/v24.0/oauth/access_token', ({ request }) => {
        const params = new URL(request.url).searchParams
        if (params.get('grant_type') === 'fb_exchange_token') {
          expect(params.get('fb_exchange_token')).toBe('FB_SHORT')
          return HttpResponse.json({ access_token: 'FB_LONG_USER', token_type: 'bearer' })
        }
        expect(Object.fromEntries(params)).toEqual({
          client_id: 'fb-app',
          client_secret: 'fb-secret',
          redirect_uri: fbApp.redirectUri,
          code: 'FBCODE',
        })
        return HttpResponse.json({ access_token: 'FB_SHORT', token_type: 'bearer', expires_in: 3600 })
      }),
      http.get('https://graph.facebook.com/v24.0/me/accounts', ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer FB_LONG_USER')
        return HttpResponse.json({
          data: [
            { id: 'page_1', name: 'Maya Makes Kitchen', username: 'mayamakeskitchen', access_token: 'PAGE_1', followers_count: 38200, picture: { data: { url: 'https://cdn.test/p1.jpg' } } },
            { id: 'page_2', name: 'No Token Page' },
          ],
        })
      }),
    )
    expect(await exchangeFacebookCode(fbApp, 'FBCODE')).toEqual([
      {
        externalId: 'page_1',
        username: 'mayamakeskitchen',
        displayName: 'Maya Makes Kitchen',
        avatarUrl: 'https://cdn.test/p1.jpg',
        followersCount: 38200,
        accessToken: 'PAGE_1',
      },
    ])
  })
})
