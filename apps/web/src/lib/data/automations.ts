import 'server-only'
import { automationVersions, automations, connectedAccounts, contacts, flowRuns, messages } from '@replyooo/db'
import { FlowDefinitionSchema, getTemplate, validateFlow, type FlowDefinition } from '@replyooo/shared'
import { and, eq, gte, inArray, max, type SQL, sql } from 'drizzle-orm'
import { db } from '../db'
import { DEFAULT_RECIPE, compileRecipe } from '../recipe'
import { isUuid } from './ids'
import type { Automation, AutomationStats, AutomationStatus, PublishResult, StatusResult } from './types'

export const STATS_WINDOW_DAYS = 30
export const DM_KINDS = ['dm', 'private_reply'] as const
const NOT_FOUND = 'Automation not found'
const EMPTY_STATS: AutomationStats = { runs: 0, completed: 0, dmsSent: 0, leads: 0 }

export function statsSince(now: Date): Date {
  return new Date(now.getTime() - STATS_WINDOW_DAYS * 86_400_000)
}

const columns = {
  id: automations.id,
  accountId: automations.connectedAccountId,
  name: automations.name,
  status: automations.status,
  flow: automations.definition,
  templateKey: automations.templateKey,
  updatedAt: automations.updatedAt,
  version: automationVersions.version,
  publishedAt: automationVersions.publishedAt,
}

function selectAutomations(where: SQL | undefined) {
  return db()
    .select(columns)
    .from(automations)
    .leftJoin(automationVersions, eq(automationVersions.id, automations.currentVersionId))
    .where(where)
}

type AutomationRow = Awaited<ReturnType<typeof selectAutomations>>[number]

function toAutomation(row: AutomationRow, stats: AutomationStats | undefined): Automation {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    status: row.status,
    flow: row.flow,
    version: row.version ?? 0,
    templateKey: row.templateKey,
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    stats: stats ?? EMPTY_STATS,
  }
}

const statusRank = (status: AutomationStatus) => ({ active: 0, paused: 1, draft: 2 })[status]

async function automationStats(ids: string[], since: Date): Promise<Map<string, AutomationStats>> {
  const stats = new Map<string, AutomationStats>()
  if (ids.length === 0) return stats

  const runRows = await db()
    .select({
      automationId: flowRuns.automationId,
      runs: sql<number>`count(*)`.mapWith(Number),
      completed: sql<number>`count(*) filter (where ${flowRuns.status} = 'completed')`.mapWith(Number),
      leads: sql<number>`count(distinct ${flowRuns.contactId}) filter (where ${contacts.email} is not null or ${contacts.phone} is not null)`.mapWith(
        Number,
      ),
    })
    .from(flowRuns)
    .innerJoin(contacts, eq(contacts.id, flowRuns.contactId))
    .where(and(inArray(flowRuns.automationId, ids), gte(flowRuns.createdAt, since)))
    .groupBy(flowRuns.automationId)

  const sentRows = await db()
    .select({ automationId: flowRuns.automationId, dmsSent: sql<number>`count(*)`.mapWith(Number) })
    .from(messages)
    .innerJoin(flowRuns, eq(flowRuns.id, messages.flowRunId))
    .where(
      and(
        inArray(flowRuns.automationId, ids),
        eq(messages.direction, 'out'),
        eq(messages.status, 'sent'),
        inArray(messages.kind, [...DM_KINDS]),
        gte(messages.createdAt, since),
      ),
    )
    .groupBy(flowRuns.automationId)

  for (const row of runRows) {
    stats.set(row.automationId, { runs: row.runs, completed: row.completed, leads: row.leads, dmsSent: 0 })
  }
  for (const row of sentRows) {
    stats.set(row.automationId, { ...(stats.get(row.automationId) ?? EMPTY_STATS), dmsSent: row.dmsSent })
  }
  return stats
}

export async function listAutomations(workspaceId: string, accountId: string, now = new Date()): Promise<Automation[]> {
  if (!isUuid(accountId)) return []
  const rows = await selectAutomations(
    and(eq(automations.workspaceId, workspaceId), eq(automations.connectedAccountId, accountId)),
  )
  const stats = await automationStats(
    rows.map((row) => row.id),
    statsSince(now),
  )
  return rows
    .map((row) => toAutomation(row, stats.get(row.id)))
    .sort(
      (a, b) =>
        statusRank(a.status) - statusRank(b.status) || b.stats.runs - a.stats.runs || b.updatedAt.localeCompare(a.updatedAt),
    )
}

export async function getAutomation(workspaceId: string, id: string, now = new Date()): Promise<Automation | null> {
  if (!isUuid(id)) return null
  const [row] = await selectAutomations(and(eq(automations.workspaceId, workspaceId), eq(automations.id, id)))
  if (!row) return null
  const stats = await automationStats([row.id], statsSince(now))
  return toAutomation(row, stats.get(row.id))
}

export async function createAutomation(
  workspaceId: string,
  accountId: string,
  templateKey: string | null,
): Promise<Automation | null> {
  if (!isUuid(accountId)) return null
  const [account] = await db()
    .select({ id: connectedAccounts.id })
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.workspaceId, workspaceId), eq(connectedAccounts.id, accountId)))
  if (!account) return null

  const template = templateKey ? getTemplate(templateKey) : undefined
  const flow = template ? structuredClone(template.flow) : compileRecipe(DEFAULT_RECIPE)
  const [row] = await db()
    .insert(automations)
    .values({
      workspaceId,
      connectedAccountId: accountId,
      name: template?.title ?? 'Untitled automation',
      triggerType: flow.trigger.type,
      definition: flow,
      templateKey: template?.key ?? null,
    })
    .returning({ id: automations.id })
  return row ? getAutomation(workspaceId, row.id) : null
}

/** Drafts may be incomplete; callers have already checked they're a well-formed FlowDefinition. */
export async function saveDraft(
  workspaceId: string,
  id: string,
  input: { name: string; flow: FlowDefinition },
): Promise<boolean> {
  if (!isUuid(id)) return false
  const updated = await db()
    .update(automations)
    .set({ name: input.name.trim() || 'Untitled automation', definition: input.flow, triggerType: input.flow.trigger.type })
    .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, id)))
    .returning({ id: automations.id })
  return updated.length > 0
}

/** A "next post" comment trigger stays on the post it already latched onto when republished. */
export function keepsPinnedPost(previous: FlowDefinition | null, next: FlowDefinition): boolean {
  const isNextPost = (flow: FlowDefinition | null) =>
    flow?.trigger.type === 'comment_keyword' && flow.trigger.posts.mode === 'next'
  return isNextPost(previous) && isNextPost(next)
}

/** Spec §5.4: validate server-side, write an immutable version, point the automation at it. */
export async function publishAutomation(workspaceId: string, id: string): Promise<PublishResult> {
  if (!isUuid(id)) return { ok: false, errors: [NOT_FOUND] }
  return db().transaction(async (tx): Promise<PublishResult> => {
    const [current] = await tx
      .select({ automation: automations, platform: connectedAccounts.platform, live: automationVersions.definition })
      .from(automations)
      .innerJoin(connectedAccounts, eq(connectedAccounts.id, automations.connectedAccountId))
      .leftJoin(automationVersions, eq(automationVersions.id, automations.currentVersionId))
      .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, id)))
      .for('update', { of: automations })
    if (!current) return { ok: false, errors: [NOT_FOUND] }

    const parsed = FlowDefinitionSchema.safeParse(current.automation.definition)
    if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) }
    const issues = validateFlow(parsed.data, current.platform)
    if (issues.length > 0) return { ok: false, errors: issues.map((issue) => issue.message) }
    const flow = parsed.data

    const [latest] = await tx
      .select({ version: max(automationVersions.version) })
      .from(automationVersions)
      .where(eq(automationVersions.automationId, id))
    const version = (latest?.version ?? 0) + 1
    const [created] = await tx
      .insert(automationVersions)
      .values({ automationId: id, version, definition: flow })
      .returning({ id: automationVersions.id })
    if (!created) throw new Error('version insert returned nothing')

    await tx
      .update(automations)
      .set({
        currentVersionId: created.id,
        status: 'active',
        triggerType: flow.trigger.type,
        pinnedMediaId: keepsPinnedPost(current.live, flow) ? current.automation.pinnedMediaId : null,
      })
      .where(eq(automations.id, id))
    return { ok: true, version }
  })
}

export async function setAutomationStatus(
  workspaceId: string,
  id: string,
  status: 'active' | 'paused',
): Promise<StatusResult> {
  if (!isUuid(id)) return { ok: false, error: NOT_FOUND }
  const [row] = await db()
    .select({ versionId: automations.currentVersionId })
    .from(automations)
    .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, id)))
  if (!row) return { ok: false, error: NOT_FOUND }
  if (!row.versionId) return { ok: false, error: 'Publish this automation first' }
  await db().update(automations).set({ status }).where(eq(automations.id, id))
  return { ok: true }
}

/** Cascades to versions and runs; in-flight conversations stop. */
export async function deleteAutomation(workspaceId: string, id: string): Promise<void> {
  if (!isUuid(id)) return
  await db().delete(automations).where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, id)))
}
