import 'server-only'
import { authUsers, subscriptions, usageCounters, workspaceInvitations, workspaceMembers, workspaces } from '@replyooo/db'
import { invitationEmail } from '@replyooo/email'
import { effectivePlan, PLAN_LIMITS, periodEnd, usagePeriod } from '@replyooo/shared'
import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { db } from '../db'
import { deliver } from '../email'
import { appUrl } from '../env'
import { clearLiveIceBreakers } from './ice-breakers'
import { isUuid } from './ids'
import type { Invitation, Member, Subscription } from './types'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type InviteResult = 'invited' | 'member' | 'invalid'

export async function listMembers(workspaceId: string): Promise<Member[]> {
  return db()
    .select({
      id: workspaceMembers.id,
      userId: workspaceMembers.userId,
      name: authUsers.name,
      email: authUsers.email,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(authUsers, eq(authUsers.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.createdAt), asc(workspaceMembers.id))
}

export async function listInvitations(workspaceId: string): Promise<Invitation[]> {
  const rows = await db()
    .select()
    .from(workspaceInvitations)
    .where(eq(workspaceInvitations.workspaceId, workspaceId))
    .orderBy(asc(workspaceInvitations.createdAt))
  return rows.map((row) => ({ id: row.id, email: row.email, role: row.role, createdAt: row.createdAt.toISOString() }))
}

/** Saves a pending invite and emails it. It's accepted when someone with that verified email signs in (lib/workspaces.ts). */
export async function inviteMember(
  workspaceId: string,
  inviter: { id: string; name: string },
  rawEmail: string,
): Promise<InviteResult> {
  const email = rawEmail.trim().toLowerCase()
  if (!EMAIL.test(email)) return 'invalid'
  const [existing] = await db()
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .innerJoin(authUsers, eq(authUsers.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), sql`lower(${authUsers.email}) = ${email}`))
  if (existing) return 'member'
  await db().insert(workspaceInvitations).values({ workspaceId, email, invitedByUserId: inviter.id }).onConflictDoNothing()
  const [workspace] = await db().select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId))
  // Re-inviting an address re-sends the email.
  deliver({
    to: email,
    ...invitationEmail({
      inviterName: inviter.name,
      workspaceName: workspace?.name ?? 'a workspace',
      url: appUrl(`/signup?email=${encodeURIComponent(email)}`),
    }),
  })
  return 'invited'
}

export async function revokeInvitation(workspaceId: string, id: string): Promise<void> {
  if (!isUuid(id)) return
  await db()
    .delete(workspaceInvitations)
    .where(and(eq(workspaceInvitations.workspaceId, workspaceId), eq(workspaceInvitations.id, id)))
}

export async function removeMember(workspaceId: string, memberId: string): Promise<void> {
  if (!isUuid(memberId)) return
  await db()
    .delete(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.id, memberId), ne(workspaceMembers.role, 'owner')),
    )
}

export async function getSubscription(workspaceId: string, now = new Date()): Promise<Subscription> {
  const [[subscription], [usage]] = await Promise.all([
    db()
      .select({
        plan: subscriptions.plan,
        billingInterval: subscriptions.billingInterval,
        status: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        dodoCustomerId: subscriptions.dodoCustomerId,
      })
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId)),
    db()
      .select({ contactsReached: usageCounters.contactsReached })
      .from(usageCounters)
      .where(and(eq(usageCounters.workspaceId, workspaceId), eq(usageCounters.period, usagePeriod(now)))),
  ])
  const plan = effectivePlan(subscription, now)
  return {
    plan,
    billedPlan: subscription?.plan ?? 'free',
    billedInterval: subscription?.billingInterval ?? 'month',
    status: subscription?.status ?? 'active',
    hasBillingAccount: Boolean(subscription?.dodoCustomerId),
    renewsAt: subscription?.currentPeriodEnd?.toISOString() ?? null,
    contactsReached: usage?.contactsReached ?? 0,
    contactsLimit: PLAN_LIMITS[plan].contactsPerMonth,
    periodEnd: periodEnd(now).toISOString(),
  }
}

/** Spec §5.2 data deletion (live conversation starters are cleared on Meta first, best-effort): every table hangs off workspaces with ON DELETE CASCADE. */
export async function deleteWorkspace(workspaceId: string): Promise<void> {
  await clearLiveIceBreakers(workspaceId)
  await db().delete(workspaces).where(eq(workspaces.id, workspaceId))
}
