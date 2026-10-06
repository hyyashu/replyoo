import 'server-only'
import { connectedAccounts, type Db, encryptToken } from '@replyooo/db'
import {
  exchangeFacebookCode,
  exchangeInstagramCode,
  facebookAuthorizeUrl,
  instagramAuthorizeUrl,
  MetaError,
  type OAuthApp,
} from '@replyooo/meta'
import { PLAN_LIMITS, type Platform } from '@replyooo/shared'
import { and, eq, ne } from 'drizzle-orm'
import { workspacePlan } from './data/limits'
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
}

async function ownedElsewhere(db: Db, workspaceId: string, platform: Platform, externalId: string): Promise<boolean> {
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

/** Spec §3.6 connected-account limit. Reconnecting an account this workspace already has never needs a new slot. */
async function hasSlot(db: Db, workspaceId: string, platform: Platform, externalId: string): Promise<boolean> {
  const rows = await db
    .select({ platform: connectedAccounts.platform, externalId: connectedAccounts.externalId })
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.workspaceId, workspaceId), ne(connectedAccounts.status, 'disconnected')))
  if (rows.some((row) => row.platform === platform && row.externalId === externalId)) return true
  return rows.length < PLAN_LIMITS[await workspacePlan(db, workspaceId, new Date())].connectedAccounts
}

/**
 * Inserts the account or refreshes it in place. An account owned by another workspace is never
 * moved (the worker matches automations by account ID), so the upsert only updates our own row.
 * Returns null when the account belongs to someone else.
 */
export async function saveConnectedAccount(db: Db, workspaceId: string, userId: string, input: AccountInput): Promise<string | null> {
  const profile = {
    username: input.username,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    followersCount: input.followersCount,
    accessTokenEnc: encryptToken(input.accessToken, tokenKey()),
    tokenExpiresAt: input.expiresAt,
    status: 'active' as const,
    connectedByUserId: userId,
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

async function connectInstagram(db: Db, workspaceId: string, userId: string, code: string): Promise<ConnectResult> {
  const connection = await exchangeInstagramCode(oauthApp('instagram'), code)
  if (!connection.accountType || !PROFESSIONAL.has(connection.accountType)) return { ok: false, error: 'personal_account' }
  if (await ownedElsewhere(db, workspaceId, 'instagram', connection.externalId)) return { ok: false, error: 'owned_elsewhere' }
  if (!(await hasSlot(db, workspaceId, 'instagram', connection.externalId))) return { ok: false, error: 'plan_limit' }

  await adapterFor('instagram').subscribeWebhooks({ externalId: connection.externalId, accessToken: connection.accessToken })
  const id = await saveConnectedAccount(db, workspaceId, userId, { platform: 'instagram', ...connection })
  return id ? { ok: true, accountIds: [id], limited: false } : { ok: false, error: 'owned_elsewhere' }
}

async function connectFacebook(db: Db, workspaceId: string, userId: string, code: string): Promise<ConnectResult> {
  const pages = await exchangeFacebookCode(oauthApp('facebook'), code)
  if (pages.length === 0) return { ok: false, error: 'no_pages' }

  const accountIds: string[] = []
  let limited = false
  for (const page of pages) {
    if (await ownedElsewhere(db, workspaceId, 'facebook', page.externalId)) continue
    if (!(await hasSlot(db, workspaceId, 'facebook', page.externalId))) {
      limited = true
      continue
    }
    await adapterFor('facebook').subscribeWebhooks({ externalId: page.externalId, accessToken: page.accessToken })
    const id = await saveConnectedAccount(db, workspaceId, userId, { platform: 'facebook', ...page, expiresAt: null })
    if (id) accountIds.push(id)
  }
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
