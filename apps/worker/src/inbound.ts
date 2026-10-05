import type { Db, Tx } from '@replyooo/db'
import {
  automationEntries,
  automationVersions,
  automations,
  connectedAccounts,
  contacts,
  flowRuns,
  messages,
  webhookEvents,
} from '@replyooo/db'
import type { TriggerCandidate } from '@replyooo/engine'
import type { AccountCredentials, NormalizedEvent, PlatformAdapter, Profile } from '@replyooo/meta'
import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import type { Deps, FlowJobData } from './deps'
import type { AccountRow, ContactRow } from './records'
import { credentials, toContactState, toRunState } from './records'
import type { Route, WaitingRun } from './route'
import { decideRoute } from './route'

export const REENTRY_COOLDOWN_MS = 24 * 60 * 60 * 1000

export type Candidate = TriggerCandidate & { versionId: string }

export async function handleInbound(deps: Deps, webhookEventId: string): Promise<void> {
  const [row] = await deps.db.select().from(webhookEvents).where(eq(webhookEvents.id, webhookEventId))
  if (!row || row.processedAt) return
  try {
    const job = await processEvent(deps, row.id, row.payload as NormalizedEvent)
    if (job) await deps.jobs.flow(job)
  } catch (error) {
    await deps.db
      .update(webhookEvents)
      .set({ error: error instanceof Error ? error.message : String(error) })
      .where(eq(webhookEvents.id, row.id))
    throw error
  }
}

async function processEvent(deps: Deps, eventRowId: string, event: NormalizedEvent): Promise<FlowJobData | null> {
  const { db } = deps
  const now = deps.now()
  const markProcessed = (executor: Db | Tx) =>
    executor.update(webhookEvents).set({ processedAt: now, error: null }).where(eq(webhookEvents.id, eventRowId))

  const [account] = await db
    .select()
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.platform, event.platform), eq(connectedAccounts.externalId, event.accountExternalId)))
  if (!account || account.status !== 'active') {
    await markProcessed(db)
    return null
  }

  const adapter = deps.adapters[account.platform]
  const creds = credentials(account, deps.tokenKey)
  const [existing] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.connectedAccountId, account.id), eq(contacts.platformUserId, event.senderId)))
  const profile = existing ? null : await fetchProfile(deps, adapter, creds, event.senderId)
  const candidates = await loadCandidates(db, account.id)
  const waitingRun = existing ? await loadWaitingRun(db, existing.id) : null
  const mediaPublishedAt =
    event.type === 'comment_created' && needsMediaTime(candidates)
      ? await adapter.getMediaPublishedAt(creds, event.mediaId).catch(() => null)
      : null

  const route = decideRoute({
    event,
    contact: existing ? toContactState(existing) : newContactState(event, profile),
    waitingRun,
    candidates,
    mediaPublishedAt,
    now,
  })
  if (route.kind === 'ignore') deps.log.debug({ reason: route.reason, eventRowId }, 'inbound event not routed')

  return db.transaction(async (tx) => {
    const contact = await upsertContact(tx, account, event, profile, now)
    const job = await applyRoute(tx, { account, contact, route, candidates, event, now })
    await tx.insert(messages).values(inboundMessage(account, contact, event, job?.runId ?? null))
    await markProcessed(tx)
    return job
  })
}

export async function loadCandidates(db: Db, accountId: string): Promise<Candidate[]> {
  const rows = await db
    .select({
      automationId: automations.id,
      versionId: automationVersions.id,
      definition: automationVersions.definition,
      publishedAt: automationVersions.publishedAt,
      pinnedMediaId: automations.pinnedMediaId,
    })
    .from(automations)
    .innerJoin(automationVersions, eq(automations.currentVersionId, automationVersions.id))
    .where(and(eq(automations.connectedAccountId, accountId), eq(automations.status, 'active')))
  return rows.map((row) => ({
    automationId: row.automationId,
    versionId: row.versionId,
    publishedAt: row.publishedAt,
    trigger: row.definition.trigger,
    pinnedMediaId: row.pinnedMediaId,
  }))
}

async function loadWaitingRun(db: Db, contactId: string): Promise<WaitingRun | null> {
  const [row] = await db
    .select({ run: flowRuns, definition: automationVersions.definition })
    .from(flowRuns)
    .innerJoin(automationVersions, eq(flowRuns.automationVersionId, automationVersions.id))
    .where(and(eq(flowRuns.contactId, contactId), eq(flowRuns.status, 'waiting')))
    .limit(1)
  return row ? { id: row.run.id, run: toRunState(row.run), flow: row.definition } : null
}

function needsMediaTime(candidates: readonly Candidate[]): boolean {
  return candidates.some(
    (c) => c.trigger.type === 'comment_keyword' && c.trigger.posts.mode === 'next' && !c.pinnedMediaId,
  )
}

async function fetchProfile(
  deps: Deps,
  adapter: PlatformAdapter,
  creds: AccountCredentials,
  userId: string,
): Promise<Profile | null> {
  try {
    return await adapter.getProfile(creds, userId)
  } catch (error) {
    deps.log.warn({ err: error, userId }, 'profile lookup failed')
    return null
  }
}

function newContactState(event: NormalizedEvent, profile: Profile | null) {
  return {
    username: event.type === 'comment_created' ? event.senderUsername : (profile?.username ?? null),
    name: profile?.name ?? (event.type === 'comment_created' ? event.senderName : null),
    email: null,
    phone: null,
    tags: [],
    fields: {},
  }
}

async function upsertContact(
  tx: Tx,
  account: AccountRow,
  event: NormalizedEvent,
  profile: Profile | null,
  now: Date,
): Promise<ContactRow> {
  const messaging = event.type !== 'comment_created'
  const initial = newContactState(event, profile)
  const [contact] = await tx
    .insert(contacts)
    .values({
      workspaceId: account.workspaceId,
      connectedAccountId: account.id,
      platformUserId: event.senderId,
      username: initial.username,
      name: initial.name,
      avatarUrl: profile?.avatarUrl ?? null,
      lastInboundAt: messaging ? new Date(event.occurredAt) : null,
    })
    .onConflictDoUpdate({
      target: [contacts.connectedAccountId, contacts.platformUserId],
      set: {
        username: sql`coalesce(excluded.username, ${contacts.username})`,
        name: sql`coalesce(${contacts.name}, excluded.name)`,
        ...(messaging ? { lastInboundAt: sql`greatest(${contacts.lastInboundAt}, excluded.last_inbound_at)` } : {}),
        updatedAt: now,
      },
    })
    .returning()
  return contact!
}

interface ApplyContext {
  account: AccountRow
  contact: ContactRow
  route: Route
  candidates: readonly Candidate[]
  event: NormalizedEvent
  now: Date
}

async function applyRoute(tx: Tx, ctx: ApplyContext): Promise<FlowJobData | null> {
  const { route, contact, account, now, event } = ctx
  if (route.kind === 'ignore') return null

  if (route.kind === 'resume') {
    const [run] = await tx
      .select({ id: flowRuns.id, contactId: flowRuns.contactId })
      .from(flowRuns)
      .where(eq(flowRuns.id, route.runId))
    return run && run.contactId === contact.id ? { runId: run.id, event: route.event } : null
  }

  const candidate = ctx.candidates.find((c) => c.automationId === route.automationId)
  if (!candidate) return null

  const entered = await tx
    .insert(automationEntries)
    .values({ automationId: candidate.automationId, contactId: contact.id, lastEnteredAt: now })
    .onConflictDoUpdate({
      target: [automationEntries.automationId, automationEntries.contactId],
      set: { lastEnteredAt: now },
      setWhere: lt(automationEntries.lastEnteredAt, new Date(now.getTime() - REENTRY_COOLDOWN_MS)),
    })
    .returning({ id: automationEntries.id })
  if (entered.length === 0) return null

  await tx
    .update(flowRuns)
    .set({
      status: 'cancelled',
      wait: null,
      waitUntil: null,
      completedAt: now,
      stateVersion: sql`${flowRuns.stateVersion} + 1`,
    })
    .where(and(eq(flowRuns.contactId, contact.id), eq(flowRuns.status, 'waiting')))

  if (
    event.type === 'comment_created' &&
    candidate.trigger.type === 'comment_keyword' &&
    candidate.trigger.posts.mode === 'next' &&
    !candidate.pinnedMediaId
  ) {
    await tx
      .update(automations)
      .set({ pinnedMediaId: event.mediaId })
      .where(and(eq(automations.id, candidate.automationId), isNull(automations.pinnedMediaId)))
  }

  const [run] = await tx
    .insert(flowRuns)
    .values({
      automationId: candidate.automationId,
      automationVersionId: candidate.versionId,
      contactId: contact.id,
      connectedAccountId: account.id,
      status: 'running',
      triggerRef: route.trigger as unknown as Record<string, unknown>,
      commentId: route.trigger.kind === 'comment' ? route.trigger.commentId : null,
    })
    .returning({ id: flowRuns.id })
  return { runId: run!.id, event: { type: 'start', trigger: route.trigger }, expectedVersion: 0 }
}

function inboundMessage(account: AccountRow, contact: ContactRow, event: NormalizedEvent, runId: string | null) {
  const common = {
    contactId: contact.id,
    connectedAccountId: account.id,
    flowRunId: runId,
    direction: 'in' as const,
    status: 'received' as const,
  }
  switch (event.type) {
    case 'dm_received':
      return { ...common, kind: 'dm' as const, body: { text: event.text }, externalId: event.messageId }
    case 'story_reply':
      return {
        ...common,
        kind: 'story_reply' as const,
        body: { text: event.text, isReaction: event.isReaction },
        externalId: event.messageId,
      }
    case 'postback':
      return {
        ...common,
        kind: 'postback' as const,
        body: { payload: event.payload, title: event.title },
        externalId: event.messageId,
      }
    case 'comment_created':
      return {
        ...common,
        kind: 'comment' as const,
        body: { text: event.text, mediaId: event.mediaId },
        externalId: event.commentId,
        commentId: event.commentId,
      }
  }
}
