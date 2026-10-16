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
import { MetaError } from '@replyooo/meta'
import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import { flagReauth } from './alerts'
import type { Deps, FlowJobData } from './deps'
import { mayStartRun } from './limits'
import { flushOutbox, stageJobs } from './outbox'
import type { Logger } from './logger'
import type { AccountRow, ContactRow } from './records'
import { pauseForMetaRateLimit } from './rate-limit'
import { credentials, toContactState, toRunState } from './records'
import type { Route, WaitingRun } from './route'
import { decideRoute } from './route'

export const REENTRY_COOLDOWN_MS = 24 * 60 * 60 * 1000
/** How long a contact's Instagram profile and follow state are trusted before the next event refreshes them. */
export const PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** After a failed profile lookup, how long until the next event tries again (instead of on every event). */
export const PROFILE_RETRY_MS = 60 * 60 * 1000

/**
 * Meta rate-limited the account (or it is paused) and the event cannot be routed without a Graph call: the job is
 * delayed, not failed, so it neither records an error nor spends an inbound attempt.
 */
export class InboundDeferred extends Error {
  constructor(readonly retryInMs: number) {
    super(`inbound event deferred ${retryInMs}ms (account rate limited)`)
    this.name = 'InboundDeferred'
  }
}

export type InboundResult = { status: 'done' } | { status: 'deferred'; retryInMs: number }

export type Candidate = TriggerCandidate & { versionId: string }

export async function handleInbound(deps: Deps, webhookEventId: string): Promise<InboundResult> {
  const [row] = await deps.db.select().from(webhookEvents).where(eq(webhookEvents.id, webhookEventId))
  if (!row || row.processedAt) return { status: 'done' }
  try {
    const staged = await processEvent(deps, row.id, row.payload as NormalizedEvent)
    await flushOutbox(deps, staged)
    return { status: 'done' }
  } catch (error) {
    if (error instanceof InboundDeferred) return { status: 'deferred', retryInMs: error.retryInMs }
    await deps.db
      .update(webhookEvents)
      .set({ error: error instanceof Error ? error.message : String(error), attempts: sql`${webhookEvents.attempts} + 1` })
      .where(eq(webhookEvents.id, row.id))
    throw error
  }
}

/** Returns the outbox rows staged with the event, to enqueue once committed. */
async function processEvent(deps: Deps, eventRowId: string, event: NormalizedEvent): Promise<string[]> {
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
    return []
  }

  const adapter = deps.adapters[account.platform]
  const creds = credentials(account, deps.tokenKey)
  const [existing] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.connectedAccountId, account.id), eq(contacts.platformUserId, event.senderId)))
  const { profile, checkedAt } = needsProfile(account, existing, now)
    ? await fetchProfile(deps, account, adapter, creds, event.senderId, now)
    : { profile: null, checkedAt: null }
  const allCandidates = await loadCandidates(db, account.id)
  // A re-run comment may only be answered by the automation that asked for it.
  const candidates =
    event.type === 'comment_created' && event.restrictToAutomationId
      ? allCandidates.filter((c) => c.automationId === event.restrictToAutomationId)
      : allCandidates
  const mediaPublishedAt =
    event.type === 'comment_created' && needsMediaTime(candidates)
      ? await fetchMediaPublishedAt(deps, account, adapter, creds, event.mediaId)
      : null

  const outcome = await db.transaction(async (tx) => {
    // The upsert row-locks the contact (insert, or ON CONFLICT DO UPDATE), serialising this contact's events
    // and flow jobs. Routing reads the waiting run under that lock, so two DMs cannot both consume one answer.
    const contact = await upsertContact(tx, account, event, profile, checkedAt, now)
    const waitingRun = await loadWaitingRun(tx, contact.id)
    const route = decideRoute({ event, contact: toContactState(contact), waitingRun, candidates, mediaPublishedAt, now })
    if (route.kind === 'ignore') deps.log.debug({ reason: route.reason, eventRowId }, 'inbound event not routed')

    const job = await applyRoute(tx, { account, contact, route, candidates, event, eventRowId, now, log: deps.log })
    await tx.insert(messages).values(inboundMessage(account, contact, event, job?.data.runId ?? null))
    const staged = job ? await stageJobs(tx, [{ kind: 'flow', ...job }]) : []
    await markProcessed(tx)
    return { route, started: job !== null, staged }
  })
  const { route } = outcome
  if (outcome.started && route.kind === 'start' && event.type === 'story_reply') {
    await reactToStoryReply(deps, adapter, creds, candidates, route.automationId, event)
  }
  return outcome.staged
}

/** The ❤️ is a nicety: if Meta refuses it, the DM still goes out. */
async function reactToStoryReply(
  deps: Deps,
  adapter: PlatformAdapter,
  creds: AccountCredentials,
  candidates: readonly Candidate[],
  automationId: string,
  event: Extract<NormalizedEvent, { type: 'story_reply' }>,
): Promise<void> {
  const trigger = candidates.find((c) => c.automationId === automationId)?.trigger
  if (trigger?.type !== 'story_reply' || !trigger.reactWithHeart || !adapter.reactToMessage) return
  try {
    await adapter.reactToMessage(creds, event.senderId, event.messageId)
  } catch (error) {
    deps.log.warn({ err: error, automationId }, 'story reply reaction failed')
  }
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

async function loadWaitingRun(db: Db | Tx, contactId: string): Promise<WaitingRun | null> {
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

/** New contacts, and Instagram contacts whose profile (and follow state) is older than PROFILE_TTL_MS. */
function needsProfile(account: AccountRow, existing: ContactRow | undefined, now: Date): boolean {
  if (!existing) return true
  // Facebook profiles carry no follow state and rarely change; they are fetched once.
  if (account.platform !== 'instagram') return false
  return existing.followCheckedAt === null || now.getTime() - existing.followCheckedAt.getTime() > PROFILE_TTL_MS
}

/**
 * The profile is a nicety: the event is handled without it, but a dead token still flags the account and a rate
 * limit pauses it. `checkedAt` is what to stamp as followCheckedAt: now on success; on failure a time that makes
 * the next lookup due PROFILE_RETRY_MS from now, so a failing lookup is not retried on every event. Null (stamp
 * nothing) when the account is paused and no call was made.
 */
async function fetchProfile(
  deps: Deps,
  account: AccountRow,
  adapter: PlatformAdapter,
  creds: AccountCredentials,
  userId: string,
  now: Date,
): Promise<{ profile: Profile | null; checkedAt: Date | null }> {
  if ((await deps.rateLimiter.pausedMs(account.id)) > 0) return { profile: null, checkedAt: null }
  try {
    return { profile: await adapter.getProfile(creds, userId), checkedAt: now }
  } catch (error) {
    if (error instanceof MetaError && error.kind === 'reauth') await flagReauth(deps, account.id)
    if (error instanceof MetaError && error.details.reason === 'rate_limited') await pauseForMetaRateLimit(deps, account.id, error)
    deps.log.warn({ err: error, userId }, 'profile lookup failed')
    return { profile: null, checkedAt: new Date(now.getTime() - PROFILE_TTL_MS + PROFILE_RETRY_MS) }
  }
}

/**
 * Routing for "next post" automations needs the post's time, so a transient failure retries the job rather than
 * routing without it. A post Meta will not return (deleted, not ours) routes as unknown.
 */
async function fetchMediaPublishedAt(
  deps: Deps,
  account: AccountRow,
  adapter: PlatformAdapter,
  creds: AccountCredentials,
  mediaId: string,
): Promise<Date | null> {
  const paused = await deps.rateLimiter.pausedMs(account.id)
  if (paused > 0) throw new InboundDeferred(paused)
  try {
    return await adapter.getMediaPublishedAt(creds, mediaId)
  } catch (error) {
    if (error instanceof MetaError && error.details.reason === 'rate_limited') {
      throw new InboundDeferred(await pauseForMetaRateLimit(deps, account.id, error))
    }
    if (!(error instanceof MetaError) || error.kind === 'retryable') throw error
    if (error.kind === 'reauth') await flagReauth(deps, account.id)
    deps.log.warn({ err: error, mediaId, reason: error.details.reason }, 'media lookup failed')
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
  checkedAt: Date | null,
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
      followsYou: profile?.followsYou ?? null,
      youFollow: profile?.youFollow ?? null,
      // Stamped whenever a lookup was made, so the next one waits (PROFILE_TTL_MS after an answer, even one without
      // follow state; PROFILE_RETRY_MS after a failure).
      followCheckedAt: account.platform === 'instagram' ? checkedAt : null,
      lastInboundAt: messaging ? new Date(event.occurredAt) : null,
    })
    .onConflictDoUpdate({
      target: [contacts.connectedAccountId, contacts.platformUserId],
      set: {
        username: sql`coalesce(excluded.username, ${contacts.username})`,
        name: sql`coalesce(${contacts.name}, excluded.name)`,
        // A refreshed profile (stale Instagram contact) replaces the picture and follow state.
        ...(profile
          ? {
              avatarUrl: sql`coalesce(excluded.avatar_url, ${contacts.avatarUrl})`,
              followsYou: sql`coalesce(excluded.follows_you, ${contacts.followsYou})`,
              youFollow: sql`coalesce(excluded.you_follow, ${contacts.youFollow})`,
            }
          : {}),
        // A failed lookup stamps a back-dated time; never move an existing stamp backwards.
        ...(checkedAt ? { followCheckedAt: sql`greatest(${contacts.followCheckedAt}, excluded.follow_checked_at)` } : {}),
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
  eventRowId: string
  now: Date
  log: Logger
}

type RoutedJob = { jobId: string; data: FlowJobData }

async function applyRoute(tx: Tx, ctx: ApplyContext): Promise<RoutedJob | null> {
  const { route, contact, account, now, event } = ctx
  if (route.kind === 'ignore') return null

  if (route.kind === 'resume') {
    const [run] = await tx
      .select({ id: flowRuns.id, contactId: flowRuns.contactId, stateVersion: flowRuns.stateVersion })
      .from(flowRuns)
      .where(eq(flowRuns.id, route.runId))
    if (!run || run.contactId !== contact.id) return null
    // One job per event, pinned to the state it answers: a redelivery or a run that moved on makes it a no-op.
    return {
      jobId: `resume-${ctx.eventRowId}`,
      data: { runId: run.id, event: route.event, expectedVersion: run.stateVersion },
    }
  }

  const candidate = ctx.candidates.find((c) => c.automationId === route.automationId)
  if (!candidate) return null
  if (event.type === 'comment_created' && event.restrictToAutomationId) {
    // A re-run comment is old news; it must not cancel a conversation the person is in the middle of.
    const [waiting] = await tx
      .select({ id: flowRuns.id })
      .from(flowRuns)
      .where(and(eq(flowRuns.contactId, contact.id), eq(flowRuns.status, 'waiting')))
      .limit(1)
    if (waiting) return null
  }
  if (!(await mayStartRun(tx, account.workspaceId, contact, now))) {
    ctx.log.info({ workspaceId: account.workspaceId, automationId: candidate.automationId }, 'monthly contact limit reached; run not started')
    return null
  }

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
  return {
    jobId: `start-${run!.id}`,
    data: { runId: run!.id, event: { type: 'start', trigger: route.trigger }, expectedVersion: 0 },
  }
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
