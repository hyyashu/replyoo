import 'server-only'
import { connectedAccounts, dataDeletionRequests, type Db } from '@replyooo/db'
import { parseSignedRequest } from '@replyooo/meta'
import type { Platform } from '@replyooo/shared'
import { and, eq, ne, or } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { clearLiveIceBreakers, settleWithin } from './data/ice-breakers'
import { env } from './env'

/** Which app signed it tells us the platform: Facebook Login uses META_APP_SECRET, Instagram Login INSTAGRAM_APP_SECRET. */
export function verifyMetaSignedRequest(signedRequest: string): { platform: Platform; userId: string } | null {
  const e = env()
  const apps: [Platform, string][] = [
    ['facebook', e.META_APP_SECRET],
    ['instagram', e.INSTAGRAM_APP_SECRET],
  ]
  for (const [platform, secret] of apps) {
    const parsed = parseSignedRequest(signedRequest, secret)
    if (parsed && parsed.userId !== '') return { platform, userId: parsed.userId }
  }
  return null
}

/**
 * The accounts a Meta user granted. Keyed by the Meta user (authenticated by the signed request),
 * not by workspace: these callbacks come from Meta, not from a signed-in session. Instagram also
 * matches the account id, in case Meta sends that instead of the app-scoped id.
 */
function grantedBy(platform: Platform, userId: string) {
  const byUser = eq(connectedAccounts.metaUserId, userId)
  return and(eq(connectedAccounts.platform, platform), platform === 'instagram' ? or(byUser, eq(connectedAccounts.externalId, userId)) : byUser)
}

/** How long the callbacks wait for Meta to clear conversation starters before answering Meta anyway. */
export const ICE_BREAKER_CLEAR_BUDGET_MS = 3_000

/**
 * Same cleanup as a manual disconnect: clear Meta's conversation starters for the granted accounts
 * that are still connected and have a live ice-breaker automation. Best-effort (the token may
 * already be revoked); failures are only logged. The clears run in parallel and are bounded by
 * ICE_BREAKER_CLEAR_BUDGET_MS so a slow Graph API (15 s timeout per call) can't hold Meta's
 * callback past its own timeout; stragglers finish in the background.
 */
async function clearGrantedIceBreakers(db: Db, platform: Platform, userId: string): Promise<void> {
  const rows = await db
    .select({ id: connectedAccounts.id, workspaceId: connectedAccounts.workspaceId })
    .from(connectedAccounts)
    .where(and(grantedBy(platform, userId), ne(connectedAccounts.status, 'disconnected')))
  await settleWithin(
    rows.map((row) => clearLiveIceBreakers(row.workspaceId, row.id)),
    ICE_BREAKER_CLEAR_BUDGET_MS,
  )
}

/** The person removed the app, so the tokens are dead: stop using the accounts but keep the data. */
export async function deauthorizeMetaUser(db: Db, platform: Platform, userId: string): Promise<number> {
  await clearGrantedIceBreakers(db, platform, userId)
  const rows = await db
    .update(connectedAccounts)
    .set({ status: 'disconnected' })
    .where(grantedBy(platform, userId))
    .returning({ id: connectedAccounts.id })
  return rows.length
}

/** Deletes the accounts; contacts, messages, automations and runs cascade from them. */
export async function deleteMetaUserData(
  db: Db,
  platform: Platform,
  userId: string,
): Promise<{ confirmationCode: string; accountsDeleted: number }> {
  await clearGrantedIceBreakers(db, platform, userId)
  const confirmationCode = randomBytes(8).toString('hex')
  const accountsDeleted = await db.transaction(async (tx) => {
    const deleted = await tx.delete(connectedAccounts).where(grantedBy(platform, userId)).returning({ id: connectedAccounts.id })
    await tx.insert(dataDeletionRequests).values({ confirmationCode, platform, metaUserId: userId, accountsDeleted: deleted.length })
    return deleted.length
  })
  return { confirmationCode, accountsDeleted }
}

export async function findDeletionRequest(db: Db, code: string): Promise<{ createdAt: Date; accountsDeleted: number } | null> {
  if (!/^[0-9a-f]{16}$/.test(code)) return null
  const [row] = await db
    .select({ createdAt: dataDeletionRequests.createdAt, accountsDeleted: dataDeletionRequests.accountsDeleted })
    .from(dataDeletionRequests)
    .where(eq(dataDeletionRequests.confirmationCode, code))
  return row ?? null
}

/** Reads `signed_request` from Meta's form-encoded POST and verifies it. */
export async function signedRequestFrom(request: Request) {
  const form = await request.formData().catch(() => null)
  const value = form?.get('signed_request')
  return typeof value === 'string' ? verifyMetaSignedRequest(value) : null
}
