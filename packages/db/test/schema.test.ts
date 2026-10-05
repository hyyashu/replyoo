import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../src'
import {
  automationVersions,
  automations,
  connectedAccounts,
  contacts,
  createDb,
  flowRuns,
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

function one<T>(rows: T[]): T {
  const row = rows[0]
  if (!row) throw new Error('expected a row')
  return row
}

async function seed() {
  const workspace = one(await db.insert(workspaces).values({ name: 'Acme', ownerUserId: 'user_1' }).returning())
  const account = one(
    await db
      .insert(connectedAccounts)
      .values({
        workspaceId: workspace.id,
        platform: 'instagram',
        externalId: `ig_${crypto.randomUUID()}`,
        username: 'acme',
        accessTokenEnc: 'encrypted',
      })
      .returning(),
  )
  const contact = one(
    await db
      .insert(contacts)
      .values({ workspaceId: workspace.id, connectedAccountId: account.id, platformUserId: 'igsid_1' })
      .returning(),
  )
  const automation = one(
    await db
      .insert(automations)
      .values({
        workspaceId: workspace.id,
        connectedAccountId: account.id,
        name: 'Test',
        triggerType: 'any_dm',
        definition: {
          trigger: { type: 'any_dm' },
          start: 's1',
          steps: { s1: { type: 'send_message', text: 'hi' } },
        },
      })
      .returning(),
  )
  const version = one(
    await db
      .insert(automationVersions)
      .values({ automationId: automation.id, version: 1, definition: automation.definition })
      .returning(),
  )
  return { workspace, account, contact, automation, version }
}

describe('schema', () => {
  it('generates uuid v7 ids and defaults', async () => {
    const { workspace, contact } = await seed()
    expect(workspace.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/)
    expect(contact.tags).toEqual([])
    expect(contact.fields).toEqual({})
  })

  it('allows only one contact per account + platform user', async () => {
    const { workspace, account } = await seed()
    await expect(
      db
        .insert(contacts)
        .values({ workspaceId: workspace.id, connectedAccountId: account.id, platformUserId: 'igsid_1' })
        .execute(),
    ).rejects.toThrow()
  })

  it('allows only one waiting run per contact', async () => {
    const { account, contact, automation, version } = await seed()
    const run = {
      automationId: automation.id,
      automationVersionId: version.id,
      contactId: contact.id,
      connectedAccountId: account.id,
      status: 'waiting' as const,
    }
    await db.insert(flowRuns).values(run).execute()
    await db.insert(flowRuns).values({ ...run, status: 'completed' }).execute()
    await expect(db.insert(flowRuns).values(run).execute()).rejects.toThrow()
  })

  it('allows one private reply and one public reply per comment', async () => {
    const { account, contact } = await seed()
    const base = {
      contactId: contact.id,
      connectedAccountId: account.id,
      direction: 'out' as const,
      status: 'queued' as const,
      body: { text: 'hi' },
      commentId: `comment_${crypto.randomUUID()}`,
    }
    await db.insert(messages).values({ ...base, kind: 'private_reply' }).execute()
    await db.insert(messages).values({ ...base, kind: 'comment_reply' }).execute()
    await expect(db.insert(messages).values({ ...base, kind: 'private_reply' }).execute()).rejects.toThrow()
    await expect(db.insert(messages).values({ ...base, kind: 'comment_reply' }).execute()).rejects.toThrow()
  })

  it('allows a connected account in only one workspace', async () => {
    const { workspace, account } = await seed()
    await expect(
      db
        .insert(connectedAccounts)
        .values({
          workspaceId: workspace.id,
          platform: 'instagram',
          externalId: account.externalId,
          username: 'dupe',
          accessTokenEnc: 'x',
        })
        .execute(),
    ).rejects.toThrow()
  })
})
