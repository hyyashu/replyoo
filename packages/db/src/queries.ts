import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import type { Db, Tx } from './client'
import { generateLinkCode } from './link-codes'
import {
  authUsers,
  type BioBlockConfig,
  type BioBlockType,
  bioBlocks,
  bioEvents,
  bioPages,
  clickFollowUps,
  connectedAccounts,
  linkClicks,
  messages,
  trackedLinks,
  workspaceMembers,
  workspaces,
} from './schema'

export interface AccountAlertContext {
  username: string
  platform: 'instagram' | 'facebook'
  workspaceName: string
  /** Owners' and admins' email addresses, sorted. */
  recipients: string[]
}

/** Who to tell when a connected account needs attention (spec §6: reauth → dashboard banner + email). */
export async function accountAlertContext(db: Db | Tx, accountId: string): Promise<AccountAlertContext | null> {
  const [account] = await db
    .select({
      username: connectedAccounts.username,
      platform: connectedAccounts.platform,
      workspaceId: connectedAccounts.workspaceId,
      workspaceName: workspaces.name,
    })
    .from(connectedAccounts)
    .innerJoin(workspaces, eq(workspaces.id, connectedAccounts.workspaceId))
    .where(eq(connectedAccounts.id, accountId))
  if (!account) return null
  const managers = await db
    .select({ email: authUsers.email })
    .from(workspaceMembers)
    .innerJoin(authUsers, eq(authUsers.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, account.workspaceId), inArray(workspaceMembers.role, ['owner', 'admin'])))
    .orderBy(asc(authUsers.email))
  return {
    username: account.username,
    platform: account.platform,
    workspaceName: account.workspaceName,
    recipients: managers.map((m) => m.email),
  }
}

// ---------- bio page ----------

export type BioPageRow = typeof bioPages.$inferSelect
export type BioBlockRow = typeof bioBlocks.$inferSelect
export type BioPagePatch = Partial<Pick<BioPageRow, 'displayName' | 'bio' | 'avatarUrl' | 'theme' | 'showBadge'>>

export async function getBioPageByWorkspace(db: Db | Tx, workspaceId: string): Promise<BioPageRow | null> {
  const [row] = await db.select().from(bioPages).where(eq(bioPages.workspaceId, workspaceId))
  return row ?? null
}

export async function getBioPageBySlug(db: Db | Tx, slug: string): Promise<BioPageRow | null> {
  const [row] = await db.select().from(bioPages).where(eq(bioPages.slug, slug))
  return row ?? null
}

export async function listBioBlocks(db: Db | Tx, pageId: string): Promise<BioBlockRow[]> {
  return db.select().from(bioBlocks).where(eq(bioBlocks.pageId, pageId)).orderBy(asc(bioBlocks.position), asc(bioBlocks.id))
}

/** Returns the new page, or null when the slug (or the workspace's page) already exists. */
export async function insertBioPage(
  db: Db | Tx,
  values: { workspaceId: string; slug: string; displayName: string; bio?: string; avatarUrl?: string | null },
): Promise<BioPageRow | null> {
  const [row] = await db.insert(bioPages).values(values).onConflictDoNothing().returning()
  return row ?? null
}

export async function updateBioPage(db: Db | Tx, workspaceId: string, patch: BioPagePatch): Promise<BioPageRow | null> {
  const [row] = await db.update(bioPages).set(patch).where(eq(bioPages.workspaceId, workspaceId)).returning()
  return row ?? null
}

export async function addBioBlock(
  db: Db | Tx,
  pageId: string,
  type: BioBlockType,
  config: BioBlockConfig,
): Promise<BioBlockRow> {
  const [row] = await db
    .insert(bioBlocks)
    .values({
      pageId,
      type,
      config,
      position: sql`(select coalesce(max(${bioBlocks.position}) + 1, 0) from ${bioBlocks} where ${bioBlocks.pageId} = ${pageId})`,
    })
    .returning()
  return row!
}

export async function updateBioBlock(
  db: Db | Tx,
  pageId: string,
  blockId: string,
  patch: { config?: BioBlockConfig; hidden?: boolean },
): Promise<BioBlockRow | null> {
  const [row] = await db
    .update(bioBlocks)
    .set(patch)
    .where(and(eq(bioBlocks.pageId, pageId), eq(bioBlocks.id, blockId)))
    .returning()
  return row ?? null
}

export async function deleteBioBlock(db: Db | Tx, pageId: string, blockId: string): Promise<void> {
  await db.delete(bioBlocks).where(and(eq(bioBlocks.pageId, pageId), eq(bioBlocks.id, blockId)))
}

/** Moves a block one place up or down by renumbering the whole page, so positions stay contiguous. */
export async function moveBioBlock(db: Db, pageId: string, blockId: string, direction: 'up' | 'down'): Promise<void> {
  await db.transaction(async (tx) => {
    const blocks = await listBioBlocks(tx, pageId)
    const from = blocks.findIndex((b) => b.id === blockId)
    const to = direction === 'up' ? from - 1 : from + 1
    if (from < 0 || to < 0 || to >= blocks.length) return
    const ids = blocks.map((b) => b.id)
    ;[ids[from], ids[to]] = [ids[to]!, ids[from]!]
    for (const [position, id] of ids.entries()) {
      await tx.update(bioBlocks).set({ position }).where(eq(bioBlocks.id, id))
    }
  })
}

// ---------- bio stats ----------

export async function recordBioEvent(
  db: Db | Tx,
  event: { pageId: string; blockId?: string | null; type: 'view' | 'click' },
): Promise<void> {
  await db.insert(bioEvents).values({ pageId: event.pageId, blockId: event.blockId ?? null, type: event.type })
}

export interface BioBlockStats {
  clicksWeek: number
  clicksAll: number
}

export interface BioOverview {
  viewsWeek: number
  clicksWeek: number
  blocks: Record<string, BioBlockStats>
}

/** Page totals for the last 7 days, plus clicks per block (last 7 days and all time). */
export async function bioOverview(db: Db | Tx, pageId: string): Promise<BioOverview> {
  const week = sql`now() - interval '7 days'`
  const [totals] = await db
    .select({
      views: sql<number>`count(*) filter (where ${bioEvents.type} = 'view' and ${bioEvents.createdAt} >= ${week})::int`,
      clicks: sql<number>`count(*) filter (where ${bioEvents.type} = 'click' and ${bioEvents.createdAt} >= ${week})::int`,
    })
    .from(bioEvents)
    .where(eq(bioEvents.pageId, pageId))
  const perBlock = await db
    .select({
      blockId: bioEvents.blockId,
      week: sql<number>`count(*) filter (where ${bioEvents.createdAt} >= ${week})::int`,
      all: sql<number>`count(*)::int`,
    })
    .from(bioEvents)
    .where(and(eq(bioEvents.pageId, pageId), eq(bioEvents.type, 'click'), sql`${bioEvents.blockId} is not null`))
    .groupBy(bioEvents.blockId)
  return {
    viewsWeek: totals?.views ?? 0,
    clicksWeek: totals?.clicks ?? 0,
    blocks: Object.fromEntries(perBlock.map((r) => [r.blockId!, { clicksWeek: r.week, clicksAll: r.all }])),
  }
}

/** Clicks per day for one block over the last `days` days, oldest first (UTC days, zeros included). */
export async function bioBlockDaily(
  db: Db | Tx,
  pageId: string,
  blockId: string,
  days = 14,
): Promise<{ day: string; clicks: number }[]> {
  const rows = await db.execute<{ day: string; clicks: number }>(sql`
    select to_char(d.day, 'YYYY-MM-DD') as day, count(e.id)::int as clicks
    from generate_series(
      (now() at time zone 'utc')::date - (${days}::int - 1),
      (now() at time zone 'utc')::date,
      interval '1 day'
    ) as d(day)
    left join ${bioEvents} e
      on e.page_id = ${pageId} and e.block_id = ${blockId} and e.type = 'click'
      and (e.created_at at time zone 'utc')::date = d.day::date
    group by d.day
    order by d.day
  `)
  return Array.from(rows)
}

// ---------- link click tracking ----------

export interface LinkToTrack {
  /** The button's index in the message. */
  position: number
  url: string
}

/**
 * Creates the tracked link for each button of a message, or finds it again when the message is retried.
 * Returns the codes by button position. A code that collides with an existing one is simply drawn again.
 */
export async function createTrackedLinks(
  db: Db | Tx,
  input: { messageId: string; contactId: string; automationId: string; links: LinkToTrack[] },
): Promise<Map<number, string>> {
  const codes = new Map<number, string>()
  for (let attempt = 0; attempt < 5; attempt++) {
    const missing = input.links.filter((link) => !codes.has(link.position))
    if (missing.length === 0) return codes
    await db
      .insert(trackedLinks)
      .values(
        missing.map((link) => ({
          code: generateLinkCode(),
          messageId: input.messageId,
          position: link.position,
          url: link.url,
          contactId: input.contactId,
          automationId: input.automationId,
        })),
      )
      .onConflictDoNothing()
    const rows = await db
      .select({ position: trackedLinks.position, code: trackedLinks.code })
      .from(trackedLinks)
      .where(eq(trackedLinks.messageId, input.messageId))
    for (const row of rows) codes.set(row.position, row.code)
  }
  if (input.links.some((link) => !codes.has(link.position))) throw new Error('Could not allocate link codes')
  return codes
}

export async function getTrackedLink(db: Db | Tx, code: string): Promise<{ id: string; url: string } | null> {
  const [row] = await db.select({ id: trackedLinks.id, url: trackedLinks.url }).from(trackedLinks).where(eq(trackedLinks.code, code))
  return row ?? null
}

export async function recordLinkClick(db: Db | Tx, linkId: string): Promise<void> {
  await db.insert(linkClicks).values({ linkId })
}

export interface LinkStats {
  /** People sent at least one tracked link (in a message that was actually sent). */
  recipients: number
  /** Of those, people who opened at least one. */
  clickers: number
}

/** Link numbers per automation for links created since `since`. Automations with no links are absent. */
export async function linkStatsByAutomation(db: Db | Tx, automationIds: string[], since: Date): Promise<Map<string, LinkStats>> {
  const stats = new Map<string, LinkStats>()
  if (automationIds.length === 0) return stats
  const rows = await db
    .select({
      automationId: trackedLinks.automationId,
      recipients: sql<number>`count(distinct ${trackedLinks.contactId})::int`,
      clickers: sql<number>`count(distinct ${trackedLinks.contactId}) filter (where ${linkClicks.id} is not null)::int`,
    })
    .from(trackedLinks)
    .innerJoin(messages, eq(messages.id, trackedLinks.messageId))
    .leftJoin(linkClicks, eq(linkClicks.linkId, trackedLinks.id))
    .where(and(inArray(trackedLinks.automationId, automationIds), eq(messages.status, 'sent'), gte(trackedLinks.createdAt, since)))
    .groupBy(trackedLinks.automationId)
  for (const row of rows) {
    if (row.automationId) stats.set(row.automationId, { recipients: row.recipients, clickers: row.clickers })
  }
  return stats
}

export interface LinkInsight extends LinkStats {
  url: string
  clicks: number
}

/** Per-destination numbers for one automation, most clicked first. */
export async function automationLinkInsights(db: Db | Tx, automationId: string, since: Date): Promise<LinkInsight[]> {
  return db
    .select({
      url: trackedLinks.url,
      recipients: sql<number>`count(distinct ${trackedLinks.contactId})::int`,
      clickers: sql<number>`count(distinct ${trackedLinks.contactId}) filter (where ${linkClicks.id} is not null)::int`,
      clicks: sql<number>`count(${linkClicks.id})::int`,
    })
    .from(trackedLinks)
    .innerJoin(messages, eq(messages.id, trackedLinks.messageId))
    .leftJoin(linkClicks, eq(linkClicks.linkId, trackedLinks.id))
    .where(and(eq(trackedLinks.automationId, automationId), eq(messages.status, 'sent'), gte(trackedLinks.createdAt, since)))
    .groupBy(trackedLinks.url)
    .orderBy(desc(sql`count(${linkClicks.id})`), desc(sql`count(distinct ${trackedLinks.contactId})`), asc(trackedLinks.url))
}

/** Clicks per day on one destination of an automation over the last `days` days, oldest first (UTC days, zeros included). */
export async function automationLinkDaily(
  db: Db | Tx,
  automationId: string,
  url: string,
  days = 14,
): Promise<{ day: string; clicks: number }[]> {
  const rows = await db.execute<{ day: string; clicks: number }>(sql`
    select to_char(d.day, 'YYYY-MM-DD') as day, count(c.id)::int as clicks
    from generate_series(
      (now() at time zone 'utc')::date - (${days}::int - 1),
      (now() at time zone 'utc')::date,
      interval '1 day'
    ) as d(day)
    left join (
      select lc.id, lc.created_at
      from ${linkClicks} lc
      join ${trackedLinks} tl on tl.id = lc.link_id
      where tl.automation_id = ${automationId} and tl.url = ${url}
    ) c on (c.created_at at time zone 'utc')::date = d.day::date
    group by d.day
    order by d.day
  `)
  return Array.from(rows)
}

export type AutomationDay = {
  /** UTC day, YYYY-MM-DD. */
  day: string
  /** Conversations started. */
  runs: number
  /** DMs and private replies sent. */
  dmsSent: number
  /** Taps on this automation's tracked links. */
  clicks: number
}

/** Activity per day for one automation over the last `days` days, oldest first (UTC days, zeros included). */
export async function automationDaily(db: Db | Tx, automationId: string, days = 30): Promise<AutomationDay[]> {
  const rows = await db.execute<AutomationDay>(sql`
    with bounds as (
      select (now() at time zone 'utc')::date - (${days}::int - 1) as first_day
    ),
    since as (
      select (first_day::timestamp at time zone 'utc') as at from bounds
    ),
    runs as (
      select (r.created_at at time zone 'utc')::date as day, count(*)::int as n
      from flow_runs r
      where r.automation_id = ${automationId} and r.created_at >= (select at from since)
      group by 1
    ),
    sent as (
      select (m.created_at at time zone 'utc')::date as day, count(*)::int as n
      from messages m
      join flow_runs r on r.id = m.flow_run_id
      where r.automation_id = ${automationId}
        and m.direction = 'out' and m.status = 'sent' and m.kind in ('dm', 'private_reply')
        and m.created_at >= (select at from since)
      group by 1
    ),
    clicks as (
      select (lc.created_at at time zone 'utc')::date as day, count(*)::int as n
      from link_clicks lc
      join tracked_links tl on tl.id = lc.link_id
      where tl.automation_id = ${automationId} and lc.created_at >= (select at from since)
      group by 1
    )
    select to_char(d.day, 'YYYY-MM-DD') as day,
      coalesce(runs.n, 0) as runs,
      coalesce(sent.n, 0) as "dmsSent",
      coalesce(clicks.n, 0) as clicks
    from generate_series(
      (select first_day from bounds),
      (now() at time zone 'utc')::date,
      interval '1 day'
    ) as d(day)
    left join runs on runs.day = d.day::date
    left join sent on sent.day = d.day::date
    left join clicks on clicks.day = d.day::date
    order by d.day
  `)
  return Array.from(rows)
}

export interface FollowUpStats {
  /** Follow-ups that went out. */
  sent: number
  /** Of those, how many led to a tap on one of the follow-up's links. */
  opened: number
  /** Not needed because the person had already opened the link. */
  skippedClicked: number
}

/** Click follow-up results for one automation, for follow-ups scheduled since `since`. */
export async function automationFollowUpStats(db: Db | Tx, automationId: string, since: Date): Promise<FollowUpStats> {
  const [row] = await db
    .select({
      sent: sql<number>`count(*) filter (where ${messages.status} = 'sent')::int`,
      opened: sql<number>`count(*) filter (where ${messages.status} = 'sent' and exists (
        select 1 from ${trackedLinks} tl join ${linkClicks} lc on lc.link_id = tl.id where tl.message_id = ${clickFollowUps.followUpMessageId}
      ))::int`,
      skippedClicked: sql<number>`count(*) filter (where ${clickFollowUps.status} = 'skipped' and ${clickFollowUps.reason} = 'clicked')::int`,
    })
    .from(clickFollowUps)
    .leftJoin(messages, eq(messages.id, clickFollowUps.followUpMessageId))
    .where(and(eq(clickFollowUps.automationId, automationId), gte(clickFollowUps.createdAt, since)))
  return row ?? { sent: 0, opened: 0, skippedClicked: 0 }
}
