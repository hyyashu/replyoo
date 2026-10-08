import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { Db, Tx } from './client'
import {
  authUsers,
  type BioBlockConfig,
  type BioBlockType,
  bioBlocks,
  bioEvents,
  bioPages,
  connectedAccounts,
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
