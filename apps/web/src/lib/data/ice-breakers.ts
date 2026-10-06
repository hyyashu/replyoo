import 'server-only'
import { automationVersions, automations, connectedAccounts } from '@replyooo/db'
import type { IceBreaker, MetaError } from '@replyooo/meta'
import { encodePostback, type FlowDefinition, type Platform } from '@replyooo/shared'
import { and, eq, type SQL } from 'drizzle-orm'
import { db } from '../db'
import { adapterFor, credentialsFor } from '../meta'

/** The questions Meta shows, each pointing back at this automation's item (spec §2.4 ice-breaker postbacks). */
export function iceBreakerItems(automationId: string, flow: FlowDefinition | null): IceBreaker[] {
  if (flow?.trigger.type !== 'ice_breaker') return []
  return flow.trigger.items.map((item, itemIndex) => ({
    question: item.question,
    payload: encodePostback({ kind: 'ice_breaker', automationId, itemIndex }),
  }))
}

/** An empty list clears the account's conversation starters. */
export async function pushIceBreakers(
  account: { platform: Platform; externalId: string; accessTokenEnc: string },
  items: IceBreaker[],
): Promise<void> {
  await adapterFor(account.platform).setIceBreakers(credentialsFor(account), items)
}

export function iceBreakerError(error: MetaError, username: string): string {
  if (error.kind === 'reauth') return `Meta revoked access to @${username}. Reconnect it in Settings, then publish again.`
  return `Meta didn’t accept the conversation starters: ${error.message}`
}

type AccountRow = typeof connectedAccounts.$inferSelect

/** Best-effort: the worker ignores postbacks for automations that aren't live, so stale questions are harmless. */
export async function clearIceBreakersQuietly(account: AccountRow): Promise<void> {
  try {
    await pushIceBreakers(account, [])
  } catch (error) {
    console.warn('clearing conversation starters failed', { accountId: account.id, error })
  }
}

/** Clears Meta's conversation starters for the workspace's accounts (or one account) that have a live ice-breaker automation. */
export async function clearLiveIceBreakers(workspaceId: string, accountId?: string): Promise<void> {
  const where: SQL[] = [eq(automations.workspaceId, workspaceId), eq(automations.status, 'active')]
  if (accountId) where.push(eq(automations.connectedAccountId, accountId))
  const rows = await db()
    .select({ automationId: automations.id, account: connectedAccounts, live: automationVersions.definition })
    .from(automations)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, automations.connectedAccountId))
    .leftJoin(automationVersions, eq(automationVersions.id, automations.currentVersionId))
    .where(and(...where))
  const accounts = new Map<string, AccountRow>()
  for (const row of rows) {
    if (iceBreakerItems(row.automationId, row.live).length > 0) accounts.set(row.account.id, row.account)
  }
  for (const account of accounts.values()) await clearIceBreakersQuietly(account)
}

/**
 * The account's live conversation starters, read only after any publish or status change that is
 * pushing them right now has committed: those hold the account row FOR UPDATE while they call Meta,
 * so FOR SHARE waits for them, and the next statement gets a fresh snapshot. No Meta call happens
 * here. Null when the account isn't active in this workspace.
 */
async function liveIceBreakersAfterSync(
  workspaceId: string,
  accountId: string,
): Promise<{ account: AccountRow; items: IceBreaker[] } | null> {
  return db().transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.workspaceId, workspaceId),
          eq(connectedAccounts.id, accountId),
          eq(connectedAccounts.status, 'active'),
        ),
      )
      .for('share')
    if (!account) return null
    const rows = await tx
      .select({ automationId: automations.id, live: automationVersions.definition })
      .from(automations)
      .leftJoin(automationVersions, eq(automationVersions.id, automations.currentVersionId))
      .where(
        and(
          eq(automations.workspaceId, workspaceId),
          eq(automations.connectedAccountId, accountId),
          eq(automations.status, 'active'),
        ),
      )
    const live = rows.find((row) => iceBreakerItems(row.automationId, row.live).length > 0)
    return { account, items: live ? iceBreakerItems(live.automationId, live.live) : [] }
  })
}

const sameItems = (a: IceBreaker[], b: IceBreaker[]) =>
  a.length === b.length && a.every((item, i) => item.question === b[i]?.question && item.payload === b[i]?.payload)

/**
 * After a reconnect, put the account's live conversation starters back on Meta (disconnecting cleared
 * them). Best-effort: a failure leaves the account connected and is only logged. The push runs outside
 * any transaction; re-reading afterwards catches a publish that pushed different starters while ours
 * was in flight, so ours never overwrites newer ones (bounded, so a busy account can't loop forever).
 */
export async function restoreLiveIceBreakers(workspaceId: string, accountId: string): Promise<void> {
  try {
    let onMeta: IceBreaker[] = []
    for (let round = 0; round < 3; round++) {
      const live = await liveIceBreakersAfterSync(workspaceId, accountId)
      if (!live || sameItems(live.items, onMeta)) return
      await pushIceBreakers(live.account, live.items)
      onMeta = live.items
    }
  } catch (error) {
    console.warn('restoring conversation starters failed', { accountId, error })
  }
}
