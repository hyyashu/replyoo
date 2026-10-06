import { subscriptions, workspaceInvitations, workspaces } from '@replyooo/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { listWorkspaces, resolveWorkspace, type SessionUser } from '@/lib/workspaces'
import { createUser, createWorkspace } from './support'

const asSession = (u: { id: string; name: string; email: string; emailVerified: boolean }): SessionUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  emailVerified: u.emailVerified,
})

describe('resolveWorkspace', () => {
  it('creates a personal workspace on a free plan the first time', async () => {
    const user = await createUser({ name: 'Maya Lopez' })
    const ws = await resolveWorkspace(db(), asSession(user))
    expect(ws).toMatchObject({ workspaceName: "Maya's workspace", role: 'owner', user: { id: user.id } })
    const [subscription] = await db().select().from(subscriptions).where(eq(subscriptions.workspaceId, ws.workspaceId))
    expect(subscription?.plan).toBe('free')
  })

  it('returns the same workspace on later calls', async () => {
    const user = await createUser()
    const first = await resolveWorkspace(db(), asSession(user))
    const second = await resolveWorkspace(db(), asSession(user))
    expect(second.workspaceId).toBe(first.workspaceId)
  })

  it('creates exactly one workspace when first requests race', async () => {
    const user = await createUser()
    const results = await Promise.all(Array.from({ length: 5 }, () => resolveWorkspace(db(), asSession(user))))
    expect(new Set(results.map((r) => r.workspaceId)).size).toBe(1)
    expect(await listWorkspaces(db(), user.id)).toHaveLength(1)
  })

  it('lets a verified invitee join the inviting workspace and lands them there', async () => {
    const { workspaceId } = await createWorkspace('Acme')
    const invitee = await createUser({ email: 'Sam@Example.com', emailVerified: true })
    await resolveWorkspace(db(), asSession(invitee)) // already has their own workspace
    await db().insert(workspaceInvitations).values({ workspaceId, email: 'sam@example.com', role: 'admin' })

    const ws = await resolveWorkspace(db(), asSession(invitee))
    expect(ws).toMatchObject({ workspaceId, workspaceName: 'Acme', role: 'admin' })
    expect(await db().select().from(workspaceInvitations).where(eq(workspaceInvitations.workspaceId, workspaceId))).toEqual([])
    expect(await listWorkspaces(db(), invitee.id)).toHaveLength(2)
  })

  it('does not let an unverified email accept an invitation', async () => {
    const { workspaceId } = await createWorkspace('Private')
    await db().insert(workspaceInvitations).values({ workspaceId, email: 'squatter@example.com' })
    const squatter = await createUser({ email: 'squatter@example.com', emailVerified: false })

    const ws = await resolveWorkspace(db(), asSession(squatter))
    expect(ws.workspaceId).not.toBe(workspaceId)
    expect(await db().select().from(workspaceInvitations).where(eq(workspaceInvitations.workspaceId, workspaceId))).toHaveLength(1)
  })

  it('honours a preferred workspace only when the user is a member', async () => {
    const { workspaceId: acme } = await createWorkspace('Acme Two')
    const { workspaceId: stranger } = await createWorkspace('Stranger')
    const user = await createUser({ email: 'pat@example.com', emailVerified: true })
    const own = await resolveWorkspace(db(), asSession(user))
    await db().insert(workspaceInvitations).values({ workspaceId: acme, email: 'pat@example.com' })
    await resolveWorkspace(db(), asSession(user))

    expect((await resolveWorkspace(db(), asSession(user), own.workspaceId)).workspaceId).toBe(own.workspaceId)
    expect((await resolveWorkspace(db(), asSession(user), stranger)).workspaceId).toBe(acme)
    expect((await resolveWorkspace(db(), asSession(user), 'not-a-uuid')).workspaceId).toBe(acme)
  })

  it('creates a fresh workspace after the old one is deleted', async () => {
    const user = await createUser()
    const first = await resolveWorkspace(db(), asSession(user))
    await db().delete(workspaces).where(eq(workspaces.id, first.workspaceId))
    const second = await resolveWorkspace(db(), asSession(user))
    expect(second.workspaceId).not.toBe(first.workspaceId)
    expect(second.role).toBe('owner')
  })
})
