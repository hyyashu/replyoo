import { classifyGraphError, MetaError } from './errors'
import { GRAPH_API_VERSION, graphRequest } from './graph'

export const INSTAGRAM_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
] as const

export const FACEBOOK_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'pages_read_engagement',
  'pages_manage_engagement',
] as const

const IG_AUTHORIZE = 'https://www.instagram.com/oauth/authorize'
const IG_TOKEN = 'https://api.instagram.com/oauth/access_token'
const IG_GRAPH = 'https://graph.instagram.com'
const FB_GRAPH = 'https://graph.facebook.com'
const TIMEOUT_MS = 15_000

export interface OAuthApp {
  appId: string
  appSecret: string
  redirectUri: string
  graphVersion?: string
}

export interface InstagramConnection {
  /** `user_id` from /me: the professional account ID webhooks use as `entry.id`. */
  externalId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  followersCount: number | null
  /** `BUSINESS` or `MEDIA_CREATOR` for professional accounts. */
  accountType: string | null
  accessToken: string
  expiresAt: Date
  /** `id` from /me: the app-scoped user ID Meta's deauthorize and data-deletion callbacks name. */
  metaUserId: string | null
}

export interface FacebookPageConnection {
  externalId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  followersCount: number | null
  /** Page token derived from a long-lived user token; it doesn't expire. */
  accessToken: string
}

export interface FacebookConnection {
  /** App-scoped ID of the Facebook user who granted the Pages. */
  metaUserId: string
  pages: FacebookPageConnection[]
}

export function instagramAuthorizeUrl(app: Pick<OAuthApp, 'appId' | 'redirectUri'>, state: string): string {
  const url = new URL(IG_AUTHORIZE)
  url.search = new URLSearchParams({
    client_id: app.appId,
    redirect_uri: app.redirectUri,
    response_type: 'code',
    scope: INSTAGRAM_SCOPES.join(','),
    state,
  }).toString()
  return url.toString()
}

export async function exchangeInstagramCode(app: OAuthApp, code: string, now = new Date()): Promise<InstagramConnection> {
  const short = await postForm<{ access_token?: string; data?: { access_token?: string }[] }>(IG_TOKEN, {
    client_id: app.appId,
    client_secret: app.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: app.redirectUri,
    // Instagram appends `#_` to the code in the redirect.
    code: code.replace(/#_$/, ''),
  })
  const shortToken = short.access_token ?? short.data?.[0]?.access_token
  if (!shortToken) throw new MetaError('permanent', 'Instagram did not return an access token', { reason: 'invalid_request' })

  const long = await graphRequest<{ access_token: string; expires_in: number }>({
    baseUrl: IG_GRAPH,
    path: 'access_token',
    query: { grant_type: 'ig_exchange_token', client_secret: app.appSecret, access_token: shortToken },
  })

  const me = await graphRequest<{
    id?: string | number
    user_id?: string | number
    username?: string
    name?: string
    profile_picture_url?: string
    account_type?: string
    followers_count?: number
  }>({
    baseUrl: `${IG_GRAPH}/${app.graphVersion ?? GRAPH_API_VERSION}`,
    path: 'me',
    token: long.access_token,
    query: { fields: 'id,user_id,username,name,profile_picture_url,account_type,followers_count' },
  })
  if (me.user_id === undefined || !me.username) {
    throw new MetaError('permanent', 'Instagram profile is missing user_id or username', { reason: 'invalid_request' })
  }

  return {
    externalId: String(me.user_id),
    username: me.username,
    displayName: me.name ?? null,
    avatarUrl: me.profile_picture_url ?? null,
    followersCount: me.followers_count ?? null,
    accountType: me.account_type ?? null,
    accessToken: long.access_token,
    expiresAt: new Date(now.getTime() + long.expires_in * 1000),
    metaUserId: me.id === undefined ? null : String(me.id),
  }
}

export function facebookAuthorizeUrl(
  app: Pick<OAuthApp, 'appId' | 'redirectUri' | 'graphVersion'>,
  state: string,
  configId?: string,
): string {
  const url = new URL(`https://www.facebook.com/${app.graphVersion ?? GRAPH_API_VERSION}/dialog/oauth`)
  const params = new URLSearchParams({ client_id: app.appId, redirect_uri: app.redirectUri, state, response_type: 'code' })
  if (configId) params.set('config_id', configId)
  else params.set('scope', FACEBOOK_SCOPES.join(','))
  url.search = params.toString()
  return url.toString()
}

export async function exchangeFacebookCode(app: OAuthApp, code: string): Promise<FacebookConnection> {
  const baseUrl = `${FB_GRAPH}/${app.graphVersion ?? GRAPH_API_VERSION}`
  const short = await graphRequest<{ access_token: string }>({
    baseUrl,
    path: 'oauth/access_token',
    query: { client_id: app.appId, client_secret: app.appSecret, redirect_uri: app.redirectUri, code },
  })
  const long = await graphRequest<{ access_token: string }>({
    baseUrl,
    path: 'oauth/access_token',
    query: {
      grant_type: 'fb_exchange_token',
      client_id: app.appId,
      client_secret: app.appSecret,
      fb_exchange_token: short.access_token,
    },
  })
  const me = await graphRequest<{ id: string | number }>({ baseUrl, path: 'me', token: long.access_token, query: { fields: 'id' } })
  const pages = await graphRequest<{
    data: {
      id: string
      name: string
      username?: string
      access_token?: string
      followers_count?: number
      picture?: { data?: { url?: string } }
    }[]
  }>({
    baseUrl,
    path: 'me/accounts',
    token: long.access_token,
    query: { fields: 'id,name,username,access_token,followers_count,picture{url}', limit: '100' },
  })
  return {
    metaUserId: String(me.id),
    pages: pages.data.flatMap((page) =>
      page.access_token
        ? [
            {
              externalId: page.id,
              username: page.username ?? page.name,
              displayName: page.name,
              avatarUrl: page.picture?.data?.url ?? null,
              followersCount: page.followers_count ?? null,
              accessToken: page.access_token,
            },
          ]
        : [],
    ),
  }
}

/** api.instagram.com answers with `{ error_type, code, error_message }` instead of Graph's `{ error }`. */
async function postForm<T>(url: string, fields: Record<string, string>): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { method: 'POST', body: new URLSearchParams(fields), signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (cause) {
    throw new MetaError('retryable', `OAuth request failed: ${(cause as Error).message}`, { reason: 'network' })
  }
  const body: unknown = await response.json().catch(() => ({}))
  const failed = body !== null && typeof body === 'object' && ('error_type' in body || 'error' in body)
  if (!response.ok || failed) {
    const instagram = body as { error_message?: string; code?: number }
    throw classifyGraphError(
      response.status,
      instagram.error_message ? { error: { message: instagram.error_message, code: instagram.code } } : body,
    )
  }
  return body as T
}
