import { describe, expect, it } from 'vitest'
import * as automationData from '@/lib/data/automations'
import {
  countContacts,
  getContactDetail,
  getHomeStats,
  listContacts,
  listLatestLeads,
  listTags,
  messageText,
} from '@/lib/data/contacts'
import { createAccount, createContact, createMessage, createRun, createWorkspace } from './support'

async function setup() {
  const { workspaceId } = await createWorkspace()
  const account = await createAccount(workspaceId)
  return { workspaceId, accountId: account.id }
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000)

describe('listContacts', () => {
  it('filters by search, tag and lead type within one account', async () => {
    const { workspaceId, accountId } = await setup()
    const other = await createAccount(workspaceId)
    await createContact(workspaceId, accountId, { username: 'sam.eats', name: 'Sam Eats', phone: '+15550100', tags: ['vip'] })
    await createContact(workspaceId, accountId, { username: 'priya', email: 'priya@example.com', tags: ['email-lead'] })
    await createContact(workspaceId, accountId, { username: 'lurker' })
    await createContact(workspaceId, other.id, { username: 'elsewhere', phone: '+15550199' })

    const names = async (filters = {}) => (await listContacts(workspaceId, accountId, filters)).map((c) => c.username).sort()
    expect(await names()).toEqual(['lurker', 'priya', 'sam.eats'])
    expect(await names({ q: 'SAM.EATS' })).toEqual(['sam.eats'])
    expect(await names({ q: 'example.com' })).toEqual(['priya'])
    expect(await names({ has: 'phone' })).toEqual(['sam.eats'])
    expect(await names({ has: 'email' })).toEqual(['priya'])
    expect(await names({ tag: 'vip' })).toEqual(['sam.eats'])
    expect(await names({ q: '%' })).toEqual([])
  })

  it('orders by last activity and honours the limit', async () => {
    const { workspaceId, accountId } = await setup()
    await createContact(workspaceId, accountId, { username: 'old', lastInboundAt: minutesAgo(30) })
    await createContact(workspaceId, accountId, { username: 'new', lastInboundAt: minutesAgo(1) })
    await createContact(workspaceId, accountId, { username: 'silent', lastInboundAt: null })
    expect((await listContacts(workspaceId, accountId)).map((c) => c.username)).toEqual(['new', 'old', 'silent'])
    expect(await listContacts(workspaceId, accountId, {}, { limit: 1 })).toHaveLength(1)
  })

  it('fills in display names for contacts Meta didn’t give us a profile for', async () => {
    const { workspaceId, accountId } = await setup()
    const contact = await createContact(workspaceId, accountId, { username: null, name: null, platformUserId: 'igsid_42' })
    const [listed] = await listContacts(workspaceId, accountId)
    expect(listed).toMatchObject({ id: contact.id, username: 'igsid_42', name: 'igsid_42' })
  })

  it('never returns another workspace’s contacts', async () => {
    const a = await setup()
    const b = await setup()
    const contact = await createContact(a.workspaceId, a.accountId, { email: 'x@example.com', tags: ['secret'] })
    expect(await listContacts(b.workspaceId, a.accountId)).toEqual([])
    expect(await countContacts(b.workspaceId, a.accountId)).toEqual({ total: 0, leads: 0 })
    expect(await listTags(b.workspaceId, a.accountId)).toEqual([])
    expect(await getContactDetail(b.workspaceId, a.accountId, contact.id)).toBeNull()
    expect(await getContactDetail(a.workspaceId, a.accountId, 'con_1')).toBeNull()
  })
})

describe('countContacts, listTags and listLatestLeads', () => {
  it('summarises the account’s audience', async () => {
    const { workspaceId, accountId } = await setup()
    await createContact(workspaceId, accountId, { email: 'a@example.com', tags: ['b-tag', 'a-tag'] })
    await createContact(workspaceId, accountId, { phone: '+15550100', tags: ['a-tag'] })
    await createContact(workspaceId, accountId)

    expect(await countContacts(workspaceId, accountId)).toEqual({ total: 3, leads: 2 })
    expect(await listTags(workspaceId, accountId)).toEqual(['a-tag', 'b-tag'])
    expect(await listLatestLeads(workspaceId, accountId)).toHaveLength(2)
  })
})

describe('getContactDetail', () => {
  it('returns messages oldest first and run history with automation names', async () => {
    const { workspaceId, accountId } = await setup()
    const automation = await automationData.createAutomation(workspaceId, accountId, 'comment_to_dm')
    if (!automation) throw new Error('no automation')
    await automationData.publishAutomation(workspaceId, automation.id)
    const contact = await createContact(workspaceId, accountId)
    const run = await createRun({ automationId: automation.id, contactId: contact.id, accountId, status: 'waiting' })
    await createMessage({ contactId: contact.id, accountId, direction: 'in', kind: 'comment', body: { text: 'GUIDE', mediaId: 'm1' }, createdAt: minutesAgo(3) })
    await createMessage({ contactId: contact.id, accountId, runId: run.id, kind: 'private_reply', body: { type: 'message', message: { text: 'Tap below 👇' } }, createdAt: minutesAgo(2) })
    await createMessage({ contactId: contact.id, accountId, direction: 'in', kind: 'postback', body: { payload: 'r:x', title: 'Send it to me' }, createdAt: minutesAgo(1) })

    const detail = await getContactDetail(workspaceId, accountId, contact.id)
    expect(detail?.messages.map((m) => [m.direction, m.text])).toEqual([
      ['in', 'GUIDE'],
      ['out', 'Tap below 👇'],
      ['in', 'Send it to me'],
    ])
    expect(detail?.runs).toEqual([{ automationName: automation.name, status: 'waiting', at: run.createdAt.toISOString() }])
  })
})

describe('getHomeStats', () => {
  it('counts this account’s last-30-day activity', async () => {
    const { workspaceId, accountId } = await setup()
    const automation = await automationData.createAutomation(workspaceId, accountId, 'dm_keyword')
    if (!automation) throw new Error('no automation')
    await automationData.publishAutomation(workspaceId, automation.id)
    const lead = await createContact(workspaceId, accountId, { email: 'lead@example.com' })
    const run = await createRun({ automationId: automation.id, contactId: lead.id, accountId, status: 'completed' })
    await createRun({ automationId: automation.id, contactId: lead.id, accountId, status: 'failed' })
    await createMessage({ contactId: lead.id, accountId, runId: run.id, kind: 'dm' })
    await createMessage({ contactId: lead.id, accountId, runId: run.id, kind: 'dm', createdAt: new Date(Date.now() - 31 * 86_400_000) })

    expect(await getHomeStats(workspaceId, accountId)).toEqual({ dmsSent: 1, runs: 2, completionRate: 0.5, leads: 1, liveCount: 1 })
  })
})

describe('messageText', () => {
  it('reads text from inbound, outbound, comment-reply, image and postback bodies', () => {
    expect(messageText({ text: 'hi' })).toBe('hi')
    expect(messageText({ type: 'message', message: { text: 'Here you go' } })).toBe('Here you go')
    expect(messageText({ type: 'comment', text: 'Sent!' })).toBe('Sent!')
    expect(messageText({ type: 'image', url: 'https://x' })).toBe('📷 Photo')
    expect(messageText({ payload: 'r:1', title: 'Yes please' })).toBe('Yes please')
    expect(messageText({ text: null, isReaction: true })).toBe('')
  })
})
