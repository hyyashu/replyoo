import 'server-only'
import { connectedAccounts, type Db, encryptToken, type Tx } from '@replyooo/db'
import {
  exchangeFacebookCode,
  exchangeInstagramCode,
  facebookAuthorizeUrl,
  instagramAuthorizeUrl,
  MetaError,
  type OAuthApp,
} from '@replyooo/meta'
import type { Platform } from '@replyooo/shared'
import { and, eq, ne } from 'drizzle-orm'
import { restoreLiveIceBreakersFor } from './data/ice-breakers'
import { hasAccountSlot } from './data/limits'
import { env } from './env'
import { adapterFor, tokenKey } from './meta'

export const OAUTH_COOKIE = 'replyooo_oauth'

export type ConnectError =
  | 'cancelled'
  | 'state_mismatch'
  | 'personal_account'
  | 'owned_elsewhere'
  | 'no_pages'
  | 'plan_limit'
  | 'meta_error'
/** `limited`: some granted Pages weren't connected because the plan's account limit was reached. */
export type ConnectResult = { ok: true; accountIds: string[]; limited: boolean } | { ok: false; error: ConnectError }

const PROFESSIONAL = new Set(['BUSINESS', 'MEDIA_CREATOR'])

export function isPlatform(value: string): value is Platform {
  return value === 'instagram' || value === 'facebook'
}

export function oauthApp(platform: Platform): OAuthApp {
  const e = env()
  const redirectUri = new URL(`/api/meta/oauth/${platform}/callback`, e.APP_URL).toString()
  return platform === 'instagram'
    ? { appId: e.INSTAGRAM_APP_ID, appSecret: e.INSTAGRAM_APP_SECRET, redirectUri, graphVersion: e.META_GRAPH_VERSION }
    : { appId: e.META_APP_ID, appSecret: e.META_APP_SECRET, redirectUri, graphVersion: e.META_GRAPH_VERSION }
}

export function authorizeUrl(platform: Platform, state: string): string {
  const app = oauthApp(platform)
  return platform === 'instagram' ? instagramAuthorizeUrl(app, state) : facebookAuthorizeUrl(app, state, env().META_LOGIN_CONFIG_ID)
}

/** The state cookie holds `<platform>:<nonce>`; the callback must echo the same nonce for the same platform. */
export function stateMatches(cookie: string | undefined, platform: Platform, state: string | null): boolean {
  return Boolean(cookie && state && cookie === `${platform}:${state}`)
}

interface AccountInput {
  platform: Platform
  externalId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  followersCount: number | null
  accessToken: string
  expiresAt: Date | null
  /** App-scoped Meta user who granted access; Meta's deauthorize/data-deletion callbacks name this ID. */
  metaUserId: string | null
}

async function ownedElsewhere(db: Db | Tx, workspaceId: string, platform: Platform, externalId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: connectedAccounts.id })
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.platform, platform),
        eq(connectedAccounts.externalId, externalId),
        ne(connectedAccounts.workspaceId, workspaceId),
      ),
    )
  return Boolean(row)
}

/**
 * Inserts the account or refreshes it in place. An account owned by another workspace is never
 * moved (the worker matches automations by account ID), so the upsert only updates our own row.
 * Returns null when the account belongs to someone else.
 */
export async function saveConnectedAccount(db: Db | Tx, workspaceId: string, userId: string, input: AccountInput): Promise<string | null> {
  const profile = {
    username: input.username,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    followersCount: input.followersCount,
    accessTokenEnc: encryptToken(input.accessToken, tokenKey()),
    tokenExpiresAt: input.expiresAt,
    status: 'active' as const,
    connectedByUserId: userId,
    metaUserId: input.metaUserId,
  }
  const [row] = await db
    .insert(connectedAccounts)
    .values({ workspaceId, platform: input.platform, externalId: input.externalId, ...profile })
    .onConflictDoUpdate({
      target: [connectedAccounts.platform, connectedAccounts.externalId],
      set: profile,
      setWhere: eq(connectedAccounts.workspaceId, workspaceId),
    })
    .returning({ id: connectedAccounts.id })
  return row?.id ?? null
}

/**
 * Checks ownership and the plan's account limit, subscribes webhooks and saves the account in one transaction
 * holding the workspace's limit lock, so parallel callbacks (or several Pages) can't overshoot the limit.
 * The webhook subscription runs inside it so a failed subscribe saves nothing, as before.
 */
async function connectOne(
  db: Db,
  workspaceId: string,
  userId: string,
  input: AccountInput,
): Promise<string | 'owned_elsewhere' | 'plan_limit'> {
  return db.transaction(async (tx) => {
    if (await ownedElsewhere(tx, workspaceId, input.platform, input.externalId)) return 'owned_elsewhere'
    if (!(await hasAccountSlot(tx, workspaceId, input.platform, input.externalId, new Date()))) return 'plan_limit'
    await adapterFor(input.platform).subscribeWebhooks({ externalId: input.externalId, accessToken: input.accessToken })
    return (await saveConnectedAccount(tx, workspaceId, userId, input)) ?? 'owned_elsewhere'
  })
}

async function connectInstagram(db: Db, workspaceId: string, userId: string, code: string): Promise<ConnectResult> {
  const connection = await exchangeInstagramCode(oauthApp('instagram'), code)
  if (!connection.accountType || !PROFESSIONAL.has(connection.accountType)) return { ok: false, error: 'personal_account' }
  const outcome = await connectOne(db, workspaceId, userId, { platform: 'instagram', ...connection })
  if (outcome === 'owned_elsewhere' || outcome === 'plan_limit') return { ok: false, error: outcome }
  await restoreLiveIceBreakersFor(workspaceId, [outcome])
  return { ok: true, accountIds: [outcome], limited: false }
}

async function connectFacebook(db: Db, workspaceId: string, userId: string, code: string): Promise<ConnectResult> {
  const { metaUserId, pages } = await exchangeFacebookCode(oauthApp('facebook'), code)
  if (pages.length === 0) return { ok: false, error: 'no_pages' }

  const accountIds: string[] = []
  let limited = false
  for (const page of pages) {
    const outcome = await connectOne(db, workspaceId, userId, { platform: 'facebook', ...page, metaUserId, expiresAt: null })
    if (outcome === 'plan_limit') limited = true
    else if (outcome !== 'owned_elsewhere') accountIds.push(outcome)
  }
  await restoreLiveIceBreakersFor(workspaceId, accountIds)
  if (accountIds.length > 0) return { ok: true, accountIds, limited }
  return { ok: false, error: limited ? 'plan_limit' : 'owned_elsewhere' }
}

export async function completeConnect(
  db: Db,
  platform: Platform,
  workspaceId: string,
  userId: string,
  code: string,
): Promise<ConnectResult> {
  try {
    return platform === 'instagram'
      ? await connectInstagram(db, workspaceId, userId, code)
      : await connectFacebook(db, workspaceId, userId, code)
  } catch (error) {
    if (error instanceof MetaError) return { ok: false, error: 'meta_error' }
    throw error
  }
}
