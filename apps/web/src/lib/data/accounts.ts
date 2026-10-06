import 'server-only'
import { connectedAccounts } from '@replyooo/db'
import { and, asc, eq, ne } from 'drizzle-orm'
import { db } from '../db'
import { isUuid } from './ids'
import type { ConnectedAccount } from './types'

const columns = {
  id: connectedAccounts.id,
  platform: connectedAccounts.platform,
  username: connectedAccounts.username,
  displayName: connectedAccounts.displayName,
  followers: connectedAccounts.followersCount,
  status: connectedAccounts.status,
}

export async function listAccounts(workspaceId: string): Promise<ConnectedAccount[]> {
  return db()
    .select(columns)
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.workspaceId, workspaceId), ne(connectedAccounts.status, 'disconnected')))
    .orderBy(asc(connectedAccounts.createdAt), asc(connectedAccounts.id))
}

export async function getAccount(workspaceId: string, id: string): Promise<ConnectedAccount | null> {
  if (!isUuid(id)) return null
  const [row] = await db()
    .select(columns)
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.workspaceId, workspaceId), eq(connectedAccounts.id, id)))
  return row ?? null
}

/** The account stays owned by this workspace; the worker ignores events for disconnected accounts. */
export async function disconnectAccount(workspaceId: string, id: string): Promise<void> {
  if (!isUuid(id)) return
  await db()
    .update(connectedAccounts)
    .set({ status: 'disconnected' })
    .where(and(eq(connectedAccounts.workspaceId, workspaceId), eq(connectedAccounts.id, id)))
}
