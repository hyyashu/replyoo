import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../src'
import { accountAlertContext, authUsers, connectedAccounts, createDb, workspaceMembers, workspaces } from '../src'

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

async function member(workspaceId: string, role: 'owner' | 'admin' | 'member', email: string) {
  const id = randomUUID()
  await db.insert(authUsers).values({ id, name: email, email })
  await db.insert(workspaceMembers).values({ workspaceId, userId: id, role })
}

describe('accountAlertContext', () => {
  it('returns the account, its workspace and the owners’ and admins’ emails', async () => {
    const [workspace] = await db.insert(workspaces).values({ name: 'Acme', ownerUserId: 'x' }).returning()
    const workspaceId = workspace!.id
    const tag = randomUUID().slice(0, 8)
    await member(workspaceId, 'owner', `owner-${tag}@example.com`)
    await member(workspaceId, 'admin', `admin-${tag}@example.com`)
    await member(workspaceId, 'member', `member-${tag}@example.com`)
    const [account] = await db
      .insert(connectedAccounts)
      .values({ workspaceId, platform: 'instagram', externalId: `ig_${tag}`, username: 'maya.makes', accessTokenEnc: 'x' })
      .returning()

    expect(await accountAlertContext(db, account!.id)).toEqual({
      username: 'maya.makes',
      platform: 'instagram',
      workspaceName: 'Acme',
      recipients: [`admin-${tag}@example.com`, `owner-${tag}@example.com`],
    })
  })

  it('returns null for an unknown account', async () => {
    expect(await accountAlertContext(db, randomUUID())).toBeNull()
  })
})
