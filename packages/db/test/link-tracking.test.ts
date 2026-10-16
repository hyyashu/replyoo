import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { FlowDefinition } from '@replyooo/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../src'
import {
  automationLinkDaily,
  automationLinkInsights,
  authUsers,
  automations,
  connectedAccounts,
  contacts,
  createDb,
  createTrackedLinks,
  generateLinkCode,
  getTrackedLink,
  isLinkCode,
  linkClicks,
  linkStatsByAutomation,
  messages,
  recordLinkClick,
  trackedLinks,
  workspaces,
} from '../src'

let container: StartedPostgreSqlContainer | undefined
let db: Db
let close: () => Promise<void>

beforeAll(async () => {
  let url = process.env.TEST_DATABASE_URL
  if (!url) {
    container = await new PostgreSqlContainer('postgres:18-alpine').start()
    url = container.getConnectionUri()
  }
  const created = createDb(url)
  db = created.db
  close = created.close
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) })
})

afterAll(async () => {
  await close?.()
  await container?.stop()
})

const flow: FlowDefinition = {
  trigger: { type: 'any_dm' },
  start: 's1',
  steps: { s1: { type: 'send_message', text: 'hi' } },
}

async function seed() {
  const tag = randomUUID().slice(0, 8)
  await db.insert(authUsers).values({ id: 'x', name: 'Owner', email: 'x@example.com' }).onConflictDoNothing()
  const [workspace] = await db.insert(workspaces).values({ name: 'Acme', ownerUserId: 'x' }).returning()
  const [account] = await db
    .insert(connectedAccounts)
    .values({ workspaceId: workspace!.id, platform: 'instagram', externalId: `ig_${tag}`, username: 'maya.makes', accessTokenEnc: 'x' })
    .returning()
  const [automation] = await db
    .insert(automations)
    .values({ workspaceId: workspace!.id, connectedAccountId: account!.id, name: 'Test', triggerType: 'any_dm', definition: flow })
    .returning()
  const contact = async (n: number) =>
    (
      await db
        .insert(contacts)
        .values({ workspaceId: workspace!.id, connectedAccountId: account!.id, platformUserId: `psid_${tag}_${n}` })
        .returning()
    )[0]!
  const message = async (contactId: string, status: 'sent' | 'failed' | 'queued' = 'sent') =>
    (
      await db
        .insert(messages)
        .values({
          contactId,
          connectedAccountId: account!.id,
          direction: 'out',
          kind: 'dm',
          body: { type: 'message', message: { text: 'hi' } },
          status,
        })
        .returning()
    )[0]!
  /** A tracked link for one sent (or failed) message to `contactId`. */
  const link = async (contactId: string, url: string, status: 'sent' | 'failed' = 'sent') => {
    const sent = await message(contactId, status)
    const codes = await createTrackedLinks(db, {
      messageId: sent.id,
      contactId,
      automationId: automation!.id,
      links: [{ position: 0, url }],
    })
    const code = codes.get(0)!
    const row = (await getTrackedLink(db, code))!
    return { ...row, code, messageId: sent.id }
  }
  return { automationId: automation!.id, contact, message, link }
}

const longAgo = new Date(Date.now() - 60 * 86_400_000)
const lastMonth = () => new Date(Date.now() - 30 * 86_400_000)

describe('link codes', () => {
  it('generates 8-character base62 codes', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateLinkCode()))
    expect(codes.size).toBe(500)
    for (const code of codes) expect(isLinkCode(code)).toBe(true)
  })

  it('rejects anything that is not an 8-character base62 code', () => {
    for (const bad of ['', 'abc', 'abcdefghi', 'abcd-fgh', 'abcd fgh', 'abcdefg/', '../etc/x']) {
      expect(isLinkCode(bad)).toBe(false)
    }
  })
})

describe('createTrackedLinks', () => {
  it('allocates one code per link and finds them again for the same message', async () => {
    const { contact, message, automationId } = await seed()
    const c = await contact(1)
    const m = await message(c.id)
    const input = {
      messageId: m.id,
      contactId: c.id,
      automationId,
      links: [
        { position: 0, url: 'https://a.example/one' },
        { position: 2, url: 'https://a.example/two' },
      ],
    }
    const first = await createTrackedLinks(db, input)
    expect([...first.keys()].sort()).toEqual([0, 2])
    expect(first.get(0)).not.toBe(first.get(2))

    const again = await createTrackedLinks(db, input)
    expect(again).toEqual(first)
    expect(await db.select().from(trackedLinks).where(eq(trackedLinks.messageId, m.id))).toHaveLength(2)
  })

  it('looks a link up by code and records clicks', async () => {
    const { contact, link } = await seed()
    const c = await contact(1)
    const tracked = await link(c.id, 'https://a.example/guide')
    expect(await getTrackedLink(db, tracked.code)).toEqual({ id: tracked.id, url: 'https://a.example/guide' })
    expect(await getTrackedLink(db, 'zzzzzzzz')).toBeNull()

    await recordLinkClick(db, tracked.id)
    expect(await db.select().from(linkClicks).where(eq(linkClicks.linkId, tracked.id))).toHaveLength(1)
  })
})

describe('linkStatsByAutomation', () => {
  it('counts the people sent a link and the people who clicked, once each', async () => {
    const { automationId, contact, link } = await seed()
    const [a, b, c] = [await contact(1), await contact(2), await contact(3)]
    const linkA = await link(a.id, 'https://a.example/guide')
    await link(b.id, 'https://a.example/guide')
    await link(c.id, 'https://a.example/guide', 'failed')
    await recordLinkClick(db, linkA.id)
    await recordLinkClick(db, linkA.id)

    const stats = await linkStatsByAutomation(db, [automationId], lastMonth())
    expect(stats.get(automationId)).toEqual({ recipients: 2, clickers: 1 })
  })

  it('counts a person who got several links once', async () => {
    const { automationId, contact, link } = await seed()
    const a = await contact(1)
    const first = await link(a.id, 'https://a.example/one')
    const second = await link(a.id, 'https://a.example/two')
    await recordLinkClick(db, first.id)
    await recordLinkClick(db, second.id)
    expect((await linkStatsByAutomation(db, [automationId], lastMonth())).get(automationId)).toEqual({ recipients: 1, clickers: 1 })
  })

  it('ignores links sent before the window, even if clicked inside it, so clickers never exceed recipients', async () => {
    const { automationId, contact, link } = await seed()
    const a = await contact(1)
    const old = await link(a.id, 'https://a.example/old')
    await db.update(trackedLinks).set({ createdAt: longAgo }).where(eq(trackedLinks.id, old.id))
    await recordLinkClick(db, old.id)
    expect((await linkStatsByAutomation(db, [automationId], lastMonth())).get(automationId)).toBeUndefined()
  })

  it('returns an empty map for no automations', async () => {
    expect((await linkStatsByAutomation(db, [], lastMonth())).size).toBe(0)
  })
})

describe('automationLinkInsights', () => {
  it('groups by destination and counts recipients, clickers and clicks', async () => {
    const { automationId, contact, link } = await seed()
    const [a, b] = [await contact(1), await contact(2)]
    const a1 = await link(a.id, 'https://a.example/guide')
    await link(b.id, 'https://a.example/guide')
    await link(b.id, 'https://a.example/other')
    await recordLinkClick(db, a1.id)
    await recordLinkClick(db, a1.id)

    expect(await automationLinkInsights(db, automationId, lastMonth())).toEqual([
      { url: 'https://a.example/guide', recipients: 2, clickers: 1, clicks: 2 },
      { url: 'https://a.example/other', recipients: 1, clickers: 0, clicks: 0 },
    ])
  })
})

describe('automationLinkDaily', () => {
  it('returns 14 days, oldest first, with today’s clicks', async () => {
    const { automationId, contact, link } = await seed()
    const a = await contact(1)
    const tracked = await link(a.id, 'https://a.example/guide')
    await recordLinkClick(db, tracked.id)
    await recordLinkClick(db, tracked.id)

    const days = await automationLinkDaily(db, automationId, 'https://a.example/guide')
    expect(days).toHaveLength(14)
    expect(days.map((d) => d.day)).toEqual([...days.map((d) => d.day)].sort())
    expect(days.at(-1)?.clicks).toBe(2)
    expect(days.slice(0, -1).every((d) => d.clicks === 0)).toBe(true)
  })

  it('ignores clicks on links in messages that were not sent', async () => {
    const { automationId, contact, link } = await seed()
    const a = await contact(1)
    const sent = await link(a.id, 'https://a.example/guide')
    const failed = await link(a.id, 'https://a.example/guide', 'failed')
    await recordLinkClick(db, sent.id)
    await recordLinkClick(db, failed.id)
    await recordLinkClick(db, failed.id)

    const days = await automationLinkDaily(db, automationId, 'https://a.example/guide')
    expect(days.at(-1)?.clicks).toBe(1)
  })
})

describe('deleted records', () => {
  it('keeps links working after the automation and contact are deleted', async () => {
    const { automationId, contact, link } = await seed()
    const a = await contact(1)
    const tracked = await link(a.id, 'https://a.example/guide')
    await recordLinkClick(db, tracked.id)

    await db.delete(automations).where(eq(automations.id, automationId))
    await db.delete(contacts).where(eq(contacts.id, a.id))

    expect(await getTrackedLink(db, tracked.code)).toEqual({ id: tracked.id, url: 'https://a.example/guide' })
    const [row] = await db.select().from(trackedLinks).where(eq(trackedLinks.id, tracked.id))
    expect(row).toMatchObject({ automationId: null, contactId: null, messageId: null })
    expect(await db.select().from(linkClicks).where(eq(linkClicks.linkId, tracked.id))).toHaveLength(1)
    await recordLinkClick(db, tracked.id)
    expect(await db.select().from(linkClicks).where(eq(linkClicks.linkId, tracked.id))).toHaveLength(2)
  })
})
