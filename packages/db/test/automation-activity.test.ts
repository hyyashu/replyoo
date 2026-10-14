import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { FlowDefinition } from '@replyooo/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../src'
import {
  automationDaily,
  automationFollowUpStats,
  automations,
  automationVersions,
  clickFollowUps,
  connectedAccounts,
  contacts,
  createDb,
  createTrackedLinks,
  flowRuns,
  getTrackedLink,
  linkClicks,
  messages,
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

const DAY = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY)
const lastMonth = () => daysAgo(30)

async function seed() {
  const tag = randomUUID().slice(0, 8)
  const [workspace] = await db.insert(workspaces).values({ name: 'Acme', ownerUserId: 'x' }).returning()
  const [account] = await db
    .insert(connectedAccounts)
    .values({ workspaceId: workspace!.id, platform: 'instagram', externalId: `ig_${tag}`, username: 'maya.makes', accessTokenEnc: 'x' })
    .returning()
  const [automation] = await db
    .insert(automations)
    .values({ workspaceId: workspace!.id, connectedAccountId: account!.id, name: 'Test', triggerType: 'any_dm', definition: flow })
    .returning()
  const [version] = await db.insert(automationVersions).values({ automationId: automation!.id, version: 1, definition: flow }).returning()
  let n = 0
  const contact = async () =>
    (
      await db
        .insert(contacts)
        .values({ workspaceId: workspace!.id, connectedAccountId: account!.id, platformUserId: `psid_${tag}_${n++}` })
        .returning()
    )[0]!
  const run = async (contactId: string, createdAt = new Date()) =>
    (
      await db
        .insert(flowRuns)
        .values({
          automationId: automation!.id,
          automationVersionId: version!.id,
          contactId,
          connectedAccountId: account!.id,
          status: 'completed',
          createdAt,
        })
        .returning()
    )[0]!
  const message = async (
    contactId: string,
    flowRunId: string,
    opts: { kind?: 'dm' | 'private_reply' | 'comment_reply'; status?: 'sent' | 'failed'; createdAt?: Date } = {},
  ) =>
    (
      await db
        .insert(messages)
        .values({
          contactId,
          connectedAccountId: account!.id,
          flowRunId,
          direction: 'out',
          kind: opts.kind ?? 'dm',
          body: { type: 'message', message: { text: 'hi' } },
          status: opts.status ?? 'sent',
          createdAt: opts.createdAt ?? new Date(),
        })
        .returning()
    )[0]!
  const click = async (messageId: string, contactId: string, createdAt = new Date()) => {
    const codes = await createTrackedLinks(db, { messageId, contactId, automationId: automation!.id, links: [{ position: 0, url: 'https://a.example' }] })
    const link = (await getTrackedLink(db, codes.get(0)!))!
    await db.insert(linkClicks).values({ linkId: link.id, createdAt })
  }
  const followUp = async (
    original: { id: string; contactId: string; flowRunId: string | null },
    values: { status: 'pending' | 'sent' | 'skipped'; reason?: string; followUpMessageId?: string },
  ) =>
    db.insert(clickFollowUps).values({
      messageId: original.id,
      contactId: original.contactId,
      connectedAccountId: account!.id,
      automationId: automation!.id,
      flowRunId: original.flowRunId,
      text: 'Still want it?',
      dueAt: new Date(),
      status: values.status,
      reason: values.reason ?? null,
      followUpMessageId: values.followUpMessageId ?? null,
    })
  return { automationId: automation!.id, contact, run, message, click, followUp }
}

describe('automationDaily', () => {
  it('returns 30 days, oldest first, with zeros on quiet days', async () => {
    const { automationId } = await seed()
    const days = await automationDaily(db, automationId)
    expect(days).toHaveLength(30)
    expect(days.map((d) => d.day)).toEqual([...days.map((d) => d.day)].sort())
    expect(days.at(-1)?.day).toBe(new Date().toISOString().slice(0, 10))
    expect(days.every((d) => d.runs === 0 && d.dmsSent === 0 && d.clicks === 0)).toBe(true)
  })

  it('counts conversations, sent DMs and clicks on the day they happened', async () => {
    const { automationId, contact, run, message, click } = await seed()
    const a = await contact()
    const b = await contact()
    const today = await run(a.id)
    await run(b.id, daysAgo(2))
    await run(b.id, daysAgo(40))
    const sent = await message(a.id, today.id)
    await message(a.id, today.id, { kind: 'private_reply' })
    await message(a.id, today.id, { kind: 'comment_reply' })
    await message(a.id, today.id, { status: 'failed' })
    await message(a.id, today.id, { createdAt: daysAgo(2) })
    await click(sent.id, a.id)
    await click(sent.id, a.id, daysAgo(1))

    const days = await automationDaily(db, automationId)
    expect(days.at(-1)).toMatchObject({ runs: 1, dmsSent: 2, clicks: 1 })
    expect(days.at(-2)).toMatchObject({ runs: 0, dmsSent: 0, clicks: 1 })
    expect(days.at(-3)).toMatchObject({ runs: 1, dmsSent: 1, clicks: 0 })
    expect(days.reduce((sum, d) => sum + d.runs, 0)).toBe(2)
  })

  it('takes the number of days', async () => {
    const { automationId } = await seed()
    expect(await automationDaily(db, automationId, 7)).toHaveLength(7)
  })
})

describe('automationFollowUpStats', () => {
  it('is all zeros without follow-ups', async () => {
    const { automationId } = await seed()
    expect(await automationFollowUpStats(db, automationId, lastMonth())).toEqual({ sent: 0, opened: 0, skippedClicked: 0 })
  })

  it('counts sent follow-ups, the ones that got a tap, and the ones skipped because the link was opened', async () => {
    const { automationId, contact, run, message, click, followUp } = await seed()
    const make = async () => {
      const c = await contact()
      const r = await run(c.id)
      return { c, r, original: await message(c.id, r.id) }
    }

    const opened = await make()
    const openedFollowUp = await message(opened.c.id, opened.r.id)
    await followUp(opened.original, { status: 'sent', followUpMessageId: openedFollowUp.id })
    await click(openedFollowUp.id, opened.c.id)

    const ignored = await make()
    const ignoredFollowUp = await message(ignored.c.id, ignored.r.id)
    await followUp(ignored.original, { status: 'sent', followUpMessageId: ignoredFollowUp.id })

    const failed = await make()
    const failedFollowUp = await message(failed.c.id, failed.r.id, { status: 'failed' })
    await followUp(failed.original, { status: 'sent', followUpMessageId: failedFollowUp.id })

    const clicked = await make()
    await followUp(clicked.original, { status: 'skipped', reason: 'clicked' })
    const closed = await make()
    await followUp(closed.original, { status: 'skipped', reason: 'window_closed' })
    const pending = await make()
    await followUp(pending.original, { status: 'pending' })

    expect(await automationFollowUpStats(db, automationId, lastMonth())).toEqual({ sent: 2, opened: 1, skippedClicked: 1 })
  })
})
