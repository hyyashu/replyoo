import {
  automationVersions,
  automations,
  connectedAccounts,
  contacts,
  flowRuns,
  messages,
  subscriptions,
  usageCounters,
  workspaceMembers,
} from '@replyooo/db'
import { eq } from 'drizzle-orm'
import { RecordingMailer } from '@replyooo/email/testing'
import { http, HttpResponse } from 'msw'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { disconnectAccount } from '@/lib/data/accounts'
import { createAutomation, publishAutomation } from '@/lib/data/automations'
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
import { setMailer } from '@/lib/email'
import { createAccount, createContact, createMessage, createRun, createUser, createWorkspace, mockFetch } from './support'

const server = mockFetch()
beforeEach(() => server.reset())

const mailer = new RecordingMailer()
beforeEach(() => {
  mailer.clear()
  setMailer(mailer)
})
afterAll(() => server.restore())

describe('members and invitations', () => {
  it('lists members with their names and emails', async () => {
    const { workspaceId, user } = await createWorkspace('Crew')
    expect(await listMembers(workspaceId)).toEqual([
      expect.objectContaining({ userId: user.id, name: user.name, email: user.email, role: 'owner' }),
    ])
  })

  it('invites new people once, lower-cased, and refuses existing members and bad emails', async () => {
    const { workspaceId, user } = await createWorkspace('Crew')
    expect(await inviteMember(workspaceId, user, '  Sam@Example.com ')).toBe('invited')
    expect(await inviteMember(workspaceId, user, 'sam@example.com')).toBe('invited')
    expect(await inviteMember(workspaceId, user, user.email.toUpperCase())).toBe('member')
    expect(await inviteMember(workspaceId, user, 'not-an-email')).toBe('invalid')
    expect((await listInvitations(workspaceId)).map((i) => i.email)).toEqual(['sam@example.com'])
  })

  it('emails the invitee a sign-up link, and nobody else', async () => {
    const { workspaceId, user } = await createWorkspace('Mailroom')
    expect(await inviteMember(workspaceId, user, '  Sam@Example.com ')).toBe('invited')
    expect(await inviteMember(workspaceId, user, user.email)).toBe('member')
    expect(await inviteMember(workspaceId, user, 'nope')).toBe('invalid')

    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]).toMatchObject({ to: 'sam@example.com', subject: `${user.name} invited you to Mailroom on Replyooo` })
    expect(mailer.sent[0]?.text).toContain('http://localhost:3000/signup?email=sam%40example.com')
  })

  it('revokes invitations only within the workspace', async () => {
    const a = await createWorkspace('A')
    const b = await createWorkspace('B')
    await inviteMember(a.workspaceId, a.user, 'pat@example.com')
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

const IG = 'https://graph.instagram.com/v24.0'

function messengerProfile(externalId: string, status = 200) {
  const calls: string[] = []
  server.use(
    http.all(`${IG}/${externalId}/messenger_profile`, ({ request }) => {
      calls.push(request.method)
      return HttpResponse.json(status === 200 ? { result: 'success' } : { error: { message: 'boom', code: 2 } }, { status })
    }),
  )
  return calls
}

/** A published, active conversation-starters automation with a run and a message. */
async function liveStarters() {
  const { workspaceId } = await createWorkspace('Doomed')
  const account = await createAccount(workspaceId)
  const calls = messengerProfile(account.externalId)
  const automation = await createAutomation(workspaceId, account.id, 'conversation_starters')
  if (!automation) throw new Error('no automation')
  expect(await publishAutomation(workspaceId, automation.id)).toEqual({ ok: true, version: 1 })
  const contact = await createContact(workspaceId, account.id)
  const run = await createRun({ automationId: automation.id, contactId: contact.id, accountId: account.id })
  await createMessage({ contactId: contact.id, accountId: account.id, runId: run.id })
  calls.length = 0
  return { workspaceId, account, automation, contact, calls }
}

describe('deleteWorkspace', () => {
  it('removes the workspace and everything it owns', async () => {
    const { workspaceId } = await createWorkspace('Doomed')
    const account = await createAccount(workspaceId)
    await deleteWorkspace(workspaceId)
    expect(await db().select().from(connectedAccounts).where(eq(connectedAccounts.id, account.id))).toEqual([])
    expect(await listMembers(workspaceId)).toEqual([])
  })

  it('clears live conversation starters on Meta and cascades versions, runs and messages', async () => {
    const { workspaceId, automation, contact, calls } = await liveStarters()
    await deleteWorkspace(workspaceId)

    expect(calls).toEqual(['DELETE'])
    expect(await listMembers(workspaceId)).toEqual([])
    expect(await db().select().from(automations).where(eq(automations.id, automation.id))).toEqual([])
    expect(await db().select().from(automationVersions).where(eq(automationVersions.automationId, automation.id))).toEqual([])
    expect(await db().select().from(flowRuns).where(eq(flowRuns.automationId, automation.id))).toEqual([])
    expect(await db().select().from(messages).where(eq(messages.contactId, contact.id))).toEqual([])
    expect(await db().select().from(contacts).where(eq(contacts.id, contact.id))).toEqual([])
  })

  it('still deletes when Meta fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { workspaceId, account } = await liveStarters()
    const calls = messengerProfile(account.externalId, 500)
    await deleteWorkspace(workspaceId)

    expect(calls).toEqual(['DELETE'])
    expect(warn).toHaveBeenCalled()
    expect(await listMembers(workspaceId)).toEqual([])
    expect(await db().select().from(connectedAccounts).where(eq(connectedAccounts.id, account.id))).toEqual([])
    warn.mockRestore()
  })

  it('doesn’t call Meta when no ice-breaker automation is live', async () => {
    const { workspaceId } = await createWorkspace('Quiet')
    await createAccount(workspaceId)
    await deleteWorkspace(workspaceId)
    expect(await listMembers(workspaceId)).toEqual([])
  })
})

describe('disconnectAccount', () => {
  it('clears the account’s live conversation starters on Meta', async () => {
    const { workspaceId, account, calls } = await liveStarters()
    await disconnectAccount(workspaceId, account.id)
    expect(calls).toEqual(['DELETE'])
    const [row] = await db().select().from(connectedAccounts).where(eq(connectedAccounts.id, account.id))
    expect(row?.status).toBe('disconnected')
  })
})
