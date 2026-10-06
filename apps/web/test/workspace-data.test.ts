import { connectedAccounts, subscriptions, usageCounters, workspaceMembers } from '@replyooo/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  deleteWorkspace,
  getSubscription,
  inviteMember,
  listInvitations,
  listMembers,
  removeMember,
  revokeInvitation,
} from '@/lib/data/workspace'
import { db } from '@/lib/db'
import { createAccount, createUser, createWorkspace } from './support'

describe('members and invitations', () => {
  it('lists members with their names and emails', async () => {
    const { workspaceId, user } = await createWorkspace('Crew')
    expect(await listMembers(workspaceId)).toEqual([
      expect.objectContaining({ userId: user.id, name: user.name, email: user.email, role: 'owner' }),
    ])
  })

  it('invites new people once, lower-cased, and refuses existing members and bad emails', async () => {
    const { workspaceId, user } = await createWorkspace('Crew')
    expect(await inviteMember(workspaceId, user.id, '  Sam@Example.com ')).toBe('invited')
    expect(await inviteMember(workspaceId, user.id, 'sam@example.com')).toBe('invited')
    expect(await inviteMember(workspaceId, user.id, user.email.toUpperCase())).toBe('member')
    expect(await inviteMember(workspaceId, user.id, 'not-an-email')).toBe('invalid')
    expect((await listInvitations(workspaceId)).map((i) => i.email)).toEqual(['sam@example.com'])
  })

  it('revokes invitations only within the workspace', async () => {
    const a = await createWorkspace('A')
    const b = await createWorkspace('B')
    await inviteMember(a.workspaceId, a.user.id, 'pat@example.com')
    const [invite] = await listInvitations(a.workspaceId)
    if (!invite) throw new Error('no invite')
    await revokeInvitation(b.workspaceId, invite.id)
    expect(await listInvitations(a.workspaceId)).toHaveLength(1)
    await revokeInvitation(a.workspaceId, invite.id)
    expect(await listInvitations(a.workspaceId)).toEqual([])
  })

  it('removes members but never the owner, and only within the workspace', async () => {
    const { workspaceId } = await createWorkspace('Crew')
    const other = await createWorkspace('Other')
    const teammate = await createUser({ name: 'Teammate' })
    await db().insert(workspaceMembers).values({ workspaceId, userId: teammate.id, role: 'member' })
    const members = await listMembers(workspaceId)
    const owner = members.find((m) => m.role === 'owner')
    const member = members.find((m) => m.userId === teammate.id)
    if (!owner || !member) throw new Error('missing members')

    await removeMember(workspaceId, owner.id)
    await removeMember(other.workspaceId, member.id)
    expect(await listMembers(workspaceId)).toHaveLength(2)
    await removeMember(workspaceId, member.id)
    expect((await listMembers(workspaceId)).map((m) => m.role)).toEqual(['owner'])
  })
})

describe('getSubscription', () => {
  it('reads the plan, this month’s usage and the reset date', async () => {
    const { workspaceId } = await createWorkspace('Billing')
    await db().insert(subscriptions).values({ workspaceId, plan: 'pro' })
    await db().insert(usageCounters).values([
      { workspaceId, period: '2026-10', contactsReached: 321 },
      { workspaceId, period: '2026-09', contactsReached: 999 },
    ])
    expect(await getSubscription(workspaceId, new Date('2026-10-06T10:00:00.000Z'))).toEqual({
      plan: 'pro',
      contactsReached: 321,
      contactsLimit: 5_000,
      periodEnd: '2026-11-01T00:00:00.000Z',
    })
  })

  it('defaults to the free plan with no usage', async () => {
    const { workspaceId } = await createWorkspace('Fresh')
    expect(await getSubscription(workspaceId, new Date('2026-10-06T10:00:00.000Z'))).toMatchObject({
      plan: 'free',
      contactsReached: 0,
      contactsLimit: 1_000,
    })
  })
})

describe('deleteWorkspace', () => {
  it('removes the workspace and everything it owns', async () => {
    const { workspaceId } = await createWorkspace('Doomed')
    const account = await createAccount(workspaceId)
    await deleteWorkspace(workspaceId)
    expect(await db().select().from(connectedAccounts).where(eq(connectedAccounts.id, account.id))).toEqual([])
    expect(await listMembers(workspaceId)).toEqual([])
  })
})
