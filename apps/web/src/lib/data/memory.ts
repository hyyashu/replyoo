import 'server-only'
import { FlowDefinitionSchema, getTemplate, validateFlow, type FlowDefinition } from '@replyooo/shared'
import { DEFAULT_RECIPE, compileRecipe } from '../recipe'
import { seed } from './seed'
import type { Automation, AutomationStatus, Contact, ContactFilters, Member } from './types'

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

// ---------- Automations ----------

export async function listAutomations(accountId: string) {
  return clone(
    store.automations
      .filter((a) => a.accountId === accountId)
      .sort((a, b) => statusRank(a.status) - statusRank(b.status) || b.stats.runs - a.stats.runs),
  )
}

const statusRank = (status: AutomationStatus) => ({ active: 0, paused: 1, draft: 2 })[status]

export async function getAutomation(id: string) {
  const automation = store.automations.find((a) => a.id === id)
  return automation ? clone(automation) : null
}

export async function createAutomation(accountId: string, templateKey: string | null): Promise<Automation> {
  const template = templateKey ? getTemplate(templateKey) : undefined
  const automation: Automation = {
    id: `aut_${crypto.randomUUID().slice(0, 8)}`,
    accountId,
    name: template?.title ?? 'Untitled automation',
    status: 'draft',
    flow: template ? clone(template.flow) : compileRecipe(DEFAULT_RECIPE),
    version: 0,
    templateKey: template?.key ?? null,
    updatedAt: new Date().toISOString(),
    publishedAt: null,
    stats: { runs: 0, completed: 0, dmsSent: 0, leads: 0 },
  }
  store.automations.push(automation)
  return clone(automation)
}

export async function saveDraft(id: string, input: { name: string; flow: FlowDefinition }) {
  const automation = store.automations.find((a) => a.id === id)
  if (!automation) throw new Error('Automation not found')
  automation.name = input.name.trim() || 'Untitled automation'
  automation.flow = input.flow
  automation.updatedAt = new Date().toISOString()
}

export type PublishResult = { ok: true; version: number } | { ok: false; errors: string[] }

/** Server-side publish validation (spec §5.4) — never trust the client's checks. */
export async function publishAutomation(id: string): Promise<PublishResult> {
  const automation = store.automations.find((a) => a.id === id)
  if (!automation) return { ok: false, errors: ['Automation not found'] }
  const account = store.accounts.find((a) => a.id === automation.accountId)
  if (!account) return { ok: false, errors: ['Connected account not found'] }

  const parsed = FlowDefinitionSchema.safeParse(automation.flow)
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) }
  const issues = validateFlow(parsed.data, account.platform)
  if (issues.length > 0) return { ok: false, errors: issues.map((issue) => issue.message) }

  automation.version += 1
  automation.status = 'active'
  automation.publishedAt = new Date().toISOString()
  automation.updatedAt = automation.publishedAt
  return { ok: true, version: automation.version }
}

export async function setAutomationStatus(id: string, status: 'active' | 'paused') {
  const automation = store.automations.find((a) => a.id === id)
  if (!automation || automation.version === 0) return
  automation.status = status
}

export async function deleteAutomation(id: string) {
  store.automations = store.automations.filter((a) => a.id !== id)
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
