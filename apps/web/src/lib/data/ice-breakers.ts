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
