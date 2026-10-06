import {
  type Db,
  subscriptions,
  type Tx,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from '@replyooo/db'
import { desc, eq, sql } from 'drizzle-orm'

export type Role = 'owner' | 'admin' | 'member'

export interface SessionUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
}

export interface WorkspaceContext {
  workspaceId: string
  workspaceName: string
  role: Role
  user: SessionUser
}

export interface WorkspaceSummary {
  id: string
  name: string
  role: Role
}

export const canManage = (role: Role) => role === 'owner' || role === 'admin'

/** The user's workspaces, most recently joined first. */
export async function listWorkspaces(db: Db | Tx, userId: string): Promise<WorkspaceSummary[]> {
  return db
    .select({ id: workspaces.id, name: workspaces.name, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(desc(workspaceMembers.createdAt), desc(workspaceMembers.id))
}

/**
 * The workspace a signed-in user is working in: the preferred one if they belong to it,
 * otherwise the one they joined most recently (so an accepted invite takes them there).
 * Accepts pending invitations for verified emails, and creates a personal workspace when
 * the user has none. Runs under a per-user advisory lock so parallel first requests can't
 * create two workspaces.
 */
export async function resolveWorkspace(
  db: Db,
  user: SessionUser,
  preferredId?: string | null,
): Promise<WorkspaceContext> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${user.id}))`)
    if (user.emailVerified) await acceptInvitations(tx, user)

    let memberships = await listWorkspaces(tx, user.id)
    if (memberships.length === 0) memberships = [await createPersonalWorkspace(tx, user)]

    const chosen = memberships.find((m) => m.id === preferredId) ?? memberships[0]
    if (!chosen) throw new Error('workspace resolution produced no membership')
    return { workspaceId: chosen.id, workspaceName: chosen.name, role: chosen.role, user }
  })
}

async function acceptInvitations(tx: Tx, user: SessionUser): Promise<void> {
  const invites = await tx
    .delete(workspaceInvitations)
    .where(eq(workspaceInvitations.email, user.email.toLowerCase()))
    .returning()
  for (const invite of invites) {
    await tx
      .insert(workspaceMembers)
      .values({ workspaceId: invite.workspaceId, userId: user.id, role: invite.role })
      .onConflictDoNothing()
  }
}

async function createPersonalWorkspace(tx: Tx, user: SessionUser): Promise<WorkspaceSummary> {
  const name = workspaceNameFor(user)
  const [workspace] = await tx.insert(workspaces).values({ name, ownerUserId: user.id }).returning({ id: workspaces.id })
  if (!workspace) throw new Error('workspace insert returned nothing')
  await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
  await tx.insert(subscriptions).values({ workspaceId: workspace.id, plan: 'free' })
  return { id: workspace.id, name, role: 'owner' }
}

export function workspaceNameFor(user: { name: string; email: string }): string {
  const first = user.name.trim().split(/\s+/)[0]
  if (first) return `${first}'s workspace`
  return user.email.split('@')[0] || 'My workspace'
}
