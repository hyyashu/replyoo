import 'server-only'
import { seed } from './seed'
import type { Automation, Contact, ContactFilters, Member } from './types'

/**
 * In-memory stand-in for the Postgres repositories (Plan 3 swaps these bodies for
 * Drizzle queries). Kept on globalThis so dev-server reloads don't reset it.
 */
const store: ReturnType<typeof seed> = ((globalThis as { __replyoooStore?: ReturnType<typeof seed> }).__replyoooStore ??=
  seed())

const clone = <T>(value: T): T => structuredClone(value)

export async function getWorkspace() {
  return clone(store.workspace)
}

// ---------- Contacts ----------

export async function listContacts(accountId: string, filters: ContactFilters = {}): Promise<Contact[]> {
  const q = filters.q?.trim().toLowerCase()
  return clone(
    store.contacts
      .filter((c) => c.accountId === accountId)
      .filter((c) => !q || [c.username, c.name, c.email ?? '', c.phone ?? ''].some((v) => v.toLowerCase().includes(q)))
      .filter((c) => !filters.tag || c.tags.includes(filters.tag))
      .filter((c) => !filters.has || c[filters.has] !== null)
      .sort((a, b) => b.lastInboundAt.localeCompare(a.lastInboundAt)),
  )
}

export async function listTags(accountId: string) {
  return [...new Set(store.contacts.filter((c) => c.accountId === accountId).flatMap((c) => c.tags))].sort()
}

// ---------- Workspace ----------

export async function listMembers() {
  return clone(store.members)
}

export async function inviteMember(email: string): Promise<Member> {
  const member: Member = { id: `mem_${crypto.randomUUID().slice(0, 8)}`, name: email.split('@')[0] ?? email, email, role: 'member' }
  store.members.push(member)
  return clone(member)
}

export async function removeMember(id: string) {
  store.members = store.members.filter((m) => m.id !== id || m.role === 'owner')
}

export async function getSubscription() {
  return clone(store.subscription)
}

export async function getHomeStats(accountId: string) {
  const automations = store.automations.filter((a) => a.accountId === accountId)
  const contacts = store.contacts.filter((c) => c.accountId === accountId)
  const sum = (key: keyof Automation['stats']) => automations.reduce((total, a) => total + a.stats[key], 0)
  const runs = sum('runs')
  return {
    dmsSent: sum('dmsSent'),
    runs,
    completionRate: runs === 0 ? 0 : sum('completed') / runs,
    leads: sum('leads') + contacts.filter((c) => c.email || c.phone).length,
    liveCount: automations.filter((a) => a.status === 'active').length,
  }
}

/** Spec §5.2 data deletion: removes everything owned by the workspace. */
export async function deleteWorkspaceData() {
  store.accounts = []
  store.automations = []
  store.contacts = []
  store.members = store.members.filter((m) => m.role === 'owner')
}
