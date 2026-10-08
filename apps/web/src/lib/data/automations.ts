import 'server-only'
import { type Tx, automationVersions, automations, connectedAccounts, contacts, flowRuns, messages } from '@replyooo/db'
import { MetaError } from '@replyooo/meta'
import { FlowDefinitionSchema, getTemplate, validateFlow, type DraftFlow, type FlowDefinition } from '@replyooo/shared'
import { and, eq, gte, inArray, max, ne, or, type SQL, sql } from 'drizzle-orm'
import { isDeepStrictEqual } from 'node:util'
import { db } from '../db'
import { DEFAULT_RECIPE, compileRecipe } from '../recipe'
import { clearIceBreakersQuietly, iceBreakerError, iceBreakerItems, pushIceBreakers } from './ice-breakers'
import { isUuid } from './ids'
import { liveAutomationBlock } from './limits'
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
  published: automationVersions.definition,
}

function selectAutomations(where: SQL | undefined) {
  return db()
    .select(columns)
    .from(automations)
    .leftJoin(automationVersions, eq(automationVersions.id, automations.currentVersionId))
    .where(where)
}

type AutomationRow = Awaited<ReturnType<typeof selectAutomations>>[number]

/**
 * The draft is stored as the browser sent it, the published version after strict parsing (which trims text),
 * so compare the parsed draft; one that doesn't parse can't match what was published.
 */
function differsFromPublished(draft: FlowDefinition, published: FlowDefinition | null): boolean {
  if (!published) return true
  const parsed = FlowDefinitionSchema.safeParse(draft)
  return !parsed.success || !isDeepStrictEqual(parsed.data, published)
}

function toAutomation(row: AutomationRow, stats: AutomationStats | undefined): Automation {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    status: row.status,
    flow: row.flow,
    version: row.version ?? 0,
    hasUnpublishedChanges: differsFromPublished(row.flow, row.published),
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

export type SaveDraftResult = 'saved' | 'conflict' | 'missing'

/**
 * Drafts may be incomplete; callers have already checked the outer shape (publishing parses it strictly).
 * With `base` (the draft the caller last saw or saved) the write only lands if nobody changed the draft since.
 * A draft that already equals the new one counts too, so retrying a save whose response was lost still succeeds.
 * `unconfirmed` lists drafts the caller sent whose responses never arrived; they may have landed, so they count as the base too.
 */
export async function saveDraft(
  workspaceId: string,
  id: string,
  input: { name: string; flow: DraftFlow },
  base?: unknown,
  unconfirmed: readonly unknown[] = [],
): Promise<SaveDraftResult> {
  if (!isUuid(id)) return 'missing'
  const owned = and(eq(automations.workspaceId, workspaceId), eq(automations.id, id))
  const matches = (flow: unknown) => sql`${automations.definition} = ${JSON.stringify(flow)}::jsonb`
  const updated = await db()
    .update(automations)
    .set({
      name: input.name.trim() || 'Untitled automation',
      definition: input.flow as unknown as FlowDefinition,
      triggerType: input.flow.trigger.type,
    })
    .where(
      base === undefined
        ? owned
        : and(owned, or(matches(base), matches(input.flow), ...unconfirmed.map((flow) => matches(flow)))),
    )
    .returning({ id: automations.id })
  if (updated.length > 0) return 'saved'
  if (base === undefined) return 'missing'
  const [exists] = await db().select({ id: automations.id }).from(automations).where(owned)
  return exists ? 'conflict' : 'missing'
}

/** A "next post" comment trigger stays on the post it already latched onto when republished. */
export function keepsPinnedPost(previous: FlowDefinition | null, next: FlowDefinition): boolean {
  const isNextPost = (flow: FlowDefinition | null) =>
    flow?.trigger.type === 'comment_keyword' && flow.trigger.posts.mode === 'next'
  return isNextPost(previous) && isNextPost(next)
}

type AccountRow = typeof connectedAccounts.$inferSelect

/** Other live automations on the account whose published trigger is ice_breaker → paused. */
async function pauseOtherIceBreakers(tx: Tx, workspaceId: string, accountId: string, keepId: string): Promise<void> {
  const live = tx
    .select({ id: automations.id })
    .from(automations)
    .innerJoin(automationVersions, eq(automationVersions.id, automations.currentVersionId))
    .where(
      and(
        eq(automations.connectedAccountId, accountId),
        eq(automations.status, 'active'),
        ne(automations.id, keepId),
        sql`${automationVersions.definition}->'trigger'->>'type' = 'ice_breaker'`,
      ),
    )
  await tx
    .update(automations)
    .set({ status: 'paused' })
    .where(and(eq(automations.workspaceId, workspaceId), inArray(automations.id, live)))
}

async function markReauthRequired(workspaceId: string, accountId: string): Promise<void> {
  await db()
    .update(connectedAccounts)
    .set({ status: 'reauth_required' })
    .where(and(eq(connectedAccounts.workspaceId, workspaceId), eq(connectedAccounts.id, accountId)))
}

/** Meta errors from a push inside a transaction become a user-facing message after the rollback. */
async function metaFailure(error: unknown, workspaceId: string, account: AccountRow | undefined): Promise<string> {
  if (!(error instanceof MetaError) || !account) throw error
  if (error.kind === 'reauth') await markReauthRequired(workspaceId, account.id)
  return iceBreakerError(error, account.username)
}

/**
 * Spec §5.4: validate server-side, write an immutable version, point the automation at it,
 * and (for conversation starters) push the questions to Meta before committing.
 */
export async function publishAutomation(workspaceId: string, id: string): Promise<PublishResult> {
  if (!isUuid(id)) return { ok: false, errors: [NOT_FOUND] }
  // Set inside the transaction callback; an object so TypeScript doesn't narrow it to undefined.
  const state: { account?: AccountRow } = {}
  try {
    return await db().transaction(async (tx): Promise<PublishResult> => {
      const [current] = await tx
        .select({ automation: automations, account: connectedAccounts, live: automationVersions.definition })
        .from(automations)
        .innerJoin(connectedAccounts, eq(connectedAccounts.id, automations.connectedAccountId))
        .leftJoin(automationVersions, eq(automationVersions.id, automations.currentVersionId))
        .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, id)))
        .for('update', { of: [automations, connectedAccounts] })
      if (!current) return { ok: false, errors: [NOT_FOUND] }
      state.account = current.account

      const parsed = FlowDefinitionSchema.safeParse(current.automation.definition)
      if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) }
      const issues = validateFlow(parsed.data, current.account.platform)
      if (issues.length > 0) return { ok: false, errors: issues.map((issue) => issue.message) }
      const flow = parsed.data
      if (current.automation.status !== 'active') {
        const blocked = await liveAutomationBlock(tx, workspaceId, current.automation, flow.trigger.type === 'ice_breaker', new Date())
        if (blocked) return { ok: false, errors: [blocked] }
      }

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
        .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, id)))

      const items = iceBreakerItems(id, flow)
      const wasLiveIceBreaker = current.automation.status === 'active' && iceBreakerItems(id, current.live).length > 0
      if (items.length > 0) {
        await pauseOtherIceBreakers(tx, workspaceId, current.account.id, id)
        await pushIceBreakers(current.account, items)
      } else if (wasLiveIceBreaker) {
        await pushIceBreakers(current.account, [])
      }
      return { ok: true, version }
    })
  } catch (error) {
    return { ok: false, errors: [await metaFailure(error, workspaceId, state.account)] }
  }
}

export async function setAutomationStatus(
  workspaceId: string,
  id: string,
  status: 'active' | 'paused',
): Promise<StatusResult> {
  if (!isUuid(id)) return { ok: false, error: NOT_FOUND }
  const state: { account?: AccountRow; clearAfter: boolean } = { clearAfter: false }
  try {
    const result = await db().transaction(async (tx): Promise<StatusResult> => {
      const [row] = await tx
        .select({ automation: automations, account: connectedAccounts, live: automationVersions.definition })
        .from(automations)
        .innerJoin(connectedAccounts, eq(connectedAccounts.id, automations.connectedAccountId))
        .leftJoin(automationVersions, eq(automationVersions.id, automations.currentVersionId))
        .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, id)))
        .for('update', { of: [automations, connectedAccounts] })
      if (!row) return { ok: false, error: NOT_FOUND }
      if (!row.automation.currentVersionId) return { ok: false, error: 'Publish this automation first' }
      state.account = row.account
      if (row.automation.status === status) return { ok: true }

      const items = iceBreakerItems(id, row.live)
      if (status === 'active') {
        const blocked = await liveAutomationBlock(tx, workspaceId, row.automation, items.length > 0, new Date())
        if (blocked) return { ok: false, error: blocked }
      }
      if (items.length > 0 && status === 'active') {
        await pauseOtherIceBreakers(tx, workspaceId, row.account.id, id)
        await pushIceBreakers(row.account, items)
      }
      state.clearAfter = items.length > 0 && status === 'paused'
      await tx
        .update(automations)
        .set({ status })
        .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, id)))
      return { ok: true }
    })
    if (state.clearAfter && state.account) await clearIceBreakersQuietly(state.account)
    return result
  } catch (error) {
    return { ok: false, error: await metaFailure(error, workspaceId, state.account) }
  }
}

/** Cascades to versions and runs; in-flight conversations stop. Reads the live version before the cascade removes it. */
export async function deleteAutomation(workspaceId: string, id: string): Promise<void> {
  if (!isUuid(id)) return
  const [row] = await db()
    .select({ automation: automations, account: connectedAccounts, live: automationVersions.definition })
    .from(automations)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, automations.connectedAccountId))
    .leftJoin(automationVersions, eq(automationVersions.id, automations.currentVersionId))
    .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, id)))
  if (!row) return
  await db().delete(automations).where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, id)))
  if (row.automation.status === 'active' && iceBreakerItems(id, row.live).length > 0) {
    await clearIceBreakersQuietly(row.account)
  }
}
