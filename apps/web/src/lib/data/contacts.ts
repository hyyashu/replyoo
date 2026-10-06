import 'server-only'
import { automations, contacts, flowRuns, messages } from '@replyooo/db'
import { and, arrayContains, desc, eq, gte, ilike, inArray, isNotNull, or, type SQL, sql } from 'drizzle-orm'
import { db } from '../db'
import { DM_KINDS, statsSince } from './automations'
import { isUuid } from './ids'
import type { Contact, ContactDetail, ContactFilters, HomeStats } from './types'

export const CONTACTS_PAGE_SIZE = 200
const MESSAGE_LIMIT = 50
const RUN_LIMIT = 20

const columns = {
  id: contacts.id,
  accountId: contacts.connectedAccountId,
  platformUserId: contacts.platformUserId,
  username: contacts.username,
  name: contacts.name,
  email: contacts.email,
  phone: contacts.phone,
  tags: contacts.tags,
  fields: contacts.fields,
  firstSeenAt: contacts.firstSeenAt,
  lastInboundAt: contacts.lastInboundAt,
}

interface ContactRow {
  id: string
  accountId: string
  platformUserId: string
  username: string | null
  name: string | null
  email: string | null
  phone: string | null
  tags: string[]
  fields: Record<string, string>
  firstSeenAt: Date
  lastInboundAt: Date | null
}

const LEAD = sql`(${contacts.email} is not null or ${contacts.phone} is not null)`
const count = () => sql<number>`count(*)`.mapWith(Number)

function toContact(row: ContactRow): Contact {
  const username = row.username ?? row.platformUserId
  return {
    id: row.id,
    accountId: row.accountId,
    username,
    name: row.name ?? username,
    email: row.email,
    phone: row.phone,
    tags: row.tags,
    fields: row.fields,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastInboundAt: (row.lastInboundAt ?? row.firstSeenAt).toISOString(),
  }
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`)

function scope(workspaceId: string, accountId: string, filters: ContactFilters = {}): SQL | undefined {
  const q = filters.q?.trim()
  const pattern = q ? `%${escapeLike(q)}%` : undefined
  return and(
    eq(contacts.workspaceId, workspaceId),
    eq(contacts.connectedAccountId, accountId),
    pattern
      ? or(
          ilike(contacts.username, pattern),
          ilike(contacts.name, pattern),
          ilike(contacts.email, pattern),
          ilike(contacts.phone, pattern),
        )
      : undefined,
    filters.tag ? arrayContains(contacts.tags, [filters.tag]) : undefined,
    filters.has === 'email' ? isNotNull(contacts.email) : undefined,
    filters.has === 'phone' ? isNotNull(contacts.phone) : undefined,
  )
}

export async function listContacts(
  workspaceId: string,
  accountId: string,
  filters: ContactFilters = {},
  options: { limit?: number } = {},
): Promise<Contact[]> {
  if (!isUuid(accountId)) return []
  const query = db()
    .select(columns)
    .from(contacts)
    .where(scope(workspaceId, accountId, filters))
    .orderBy(sql`${contacts.lastInboundAt} desc nulls last`, desc(contacts.firstSeenAt))
    .$dynamic()
  const rows = options.limit ? await query.limit(options.limit) : await query
  return rows.map(toContact)
}

export async function countContacts(workspaceId: string, accountId: string): Promise<{ total: number; leads: number }> {
  if (!isUuid(accountId)) return { total: 0, leads: 0 }
  const [row] = await db()
    .select({ total: count(), leads: sql<number>`count(*) filter (where ${LEAD})`.mapWith(Number) })
    .from(contacts)
    .where(scope(workspaceId, accountId))
  return row ?? { total: 0, leads: 0 }
}

export async function listTags(workspaceId: string, accountId: string): Promise<string[]> {
  if (!isUuid(accountId)) return []
  const rows = await db()
    .selectDistinct({ tag: sql<string>`unnest(${contacts.tags})` })
    .from(contacts)
    .where(scope(workspaceId, accountId))
  return rows.map((row) => row.tag).sort()
}

export async function listLatestLeads(workspaceId: string, accountId: string, limit = 6): Promise<Contact[]> {
  if (!isUuid(accountId)) return []
  const rows = await db()
    .select(columns)
    .from(contacts)
    .where(and(scope(workspaceId, accountId), LEAD))
    .orderBy(desc(contacts.updatedAt))
    .limit(limit)
  return rows.map(toContact)
}

/** Text to show for a stored message body (inbound events, outbound sends, comment replies, postbacks). */
export function messageText(body: Record<string, unknown>): string {
  if (typeof body.text === 'string') return body.text
  if (body.type === 'message') {
    const message = body.message as { text?: unknown } | undefined
    if (typeof message?.text === 'string') return message.text
  }
  if (body.type === 'image') return '📷 Photo'
  if (typeof body.title === 'string') return body.title
  return ''
}

export async function getContactDetail(workspaceId: string, accountId: string, id: string): Promise<ContactDetail | null> {
  if (!isUuid(accountId) || !isUuid(id)) return null
  const [row] = await db()
    .select(columns)
    .from(contacts)
    .where(and(scope(workspaceId, accountId), eq(contacts.id, id)))
  if (!row) return null

  const [recent, runs] = await Promise.all([
    db()
      .select({ direction: messages.direction, body: messages.body, at: messages.createdAt })
      .from(messages)
      .where(eq(messages.contactId, id))
      .orderBy(desc(messages.createdAt))
      .limit(MESSAGE_LIMIT),
    db()
      .select({ automationName: automations.name, status: flowRuns.status, at: flowRuns.createdAt })
      .from(flowRuns)
      .innerJoin(automations, eq(automations.id, flowRuns.automationId))
      .where(eq(flowRuns.contactId, id))
      .orderBy(desc(flowRuns.createdAt))
      .limit(RUN_LIMIT),
  ])

  return {
    ...toContact(row),
    messages: recent
      .reverse()
      .map((m) => ({ direction: m.direction, text: messageText(m.body), at: m.at.toISOString() }))
      .filter((m) => m.text !== ''),
    runs: runs.map((r) => ({ automationName: r.automationName, status: r.status, at: r.at.toISOString() })),
  }
}

export async function getHomeStats(workspaceId: string, accountId: string, now = new Date()): Promise<HomeStats> {
  if (!isUuid(accountId)) return { dmsSent: 0, runs: 0, completionRate: 0, leads: 0, liveCount: 0 }
  const since = statsSince(now)
  const [[runs], [sent], audience, [live]] = await Promise.all([
    db()
      .select({ total: count(), completed: sql<number>`count(*) filter (where ${flowRuns.status} = 'completed')`.mapWith(Number) })
      .from(flowRuns)
      .innerJoin(automations, eq(automations.id, flowRuns.automationId))
      .where(
        and(eq(automations.workspaceId, workspaceId), eq(flowRuns.connectedAccountId, accountId), gte(flowRuns.createdAt, since)),
      ),
    db()
      .select({ total: count() })
      .from(messages)
      .innerJoin(contacts, eq(contacts.id, messages.contactId))
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          eq(messages.connectedAccountId, accountId),
          eq(messages.direction, 'out'),
          eq(messages.status, 'sent'),
          inArray(messages.kind, [...DM_KINDS]),
          gte(messages.createdAt, since),
        ),
      ),
    countContacts(workspaceId, accountId),
    db()
      .select({ total: count() })
      .from(automations)
      .where(
        and(
          eq(automations.workspaceId, workspaceId),
          eq(automations.connectedAccountId, accountId),
          eq(automations.status, 'active'),
        ),
      ),
  ])
  const total = runs?.total ?? 0
  return {
    dmsSent: sent?.total ?? 0,
    runs: total,
    completionRate: total === 0 ? 0 : (runs?.completed ?? 0) / total,
    leads: audience.leads,
    liveCount: live?.total ?? 0,
  }
}
