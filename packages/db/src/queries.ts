import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Db, Tx } from './client'
import { authUsers, connectedAccounts, workspaceMembers, workspaces } from './schema'

export interface AccountAlertContext {
  username: string
  platform: 'instagram' | 'facebook'
  workspaceName: string
  /** Owners' and admins' email addresses, sorted. */
  recipients: string[]
}

/** Who to tell when a connected account needs attention (spec §6: reauth → dashboard banner + email). */
export async function accountAlertContext(db: Db | Tx, accountId: string): Promise<AccountAlertContext | null> {
  const [account] = await db
    .select({
      username: connectedAccounts.username,
      platform: connectedAccounts.platform,
      workspaceId: connectedAccounts.workspaceId,
      workspaceName: workspaces.name,
    })
    .from(connectedAccounts)
    .innerJoin(workspaces, eq(workspaces.id, connectedAccounts.workspaceId))
    .where(eq(connectedAccounts.id, accountId))
  if (!account) return null
  const managers = await db
    .select({ email: authUsers.email })
    .from(workspaceMembers)
    .innerJoin(authUsers, eq(authUsers.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, account.workspaceId), inArray(workspaceMembers.role, ['owner', 'admin'])))
    .orderBy(asc(authUsers.email))
  return {
    username: account.username,
    platform: account.platform,
    workspaceName: account.workspaceName,
    recipients: managers.map((m) => m.email),
  }
}
