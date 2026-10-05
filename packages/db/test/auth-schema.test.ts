import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../src'
import { authUsers, createDb, workspaceInvitations, workspaceMembers, workspaces } from '../src'

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

describe('auth and invitation tables', () => {
  it('rejects two users with the same email', async () => {
    await db.insert(authUsers).values({ id: 'u_dup_1', name: 'A', email: 'dup@example.com' })
    await expect(db.insert(authUsers).values({ id: 'u_dup_2', name: 'B', email: 'dup@example.com' })).rejects.toThrow()
  })

  it('removes memberships when the user is deleted', async () => {
    await db.insert(authUsers).values({ id: 'u_gone', name: 'Gone', email: 'gone@example.com' })
    const workspace = one(await db.insert(workspaces).values({ name: 'W', ownerUserId: 'u_gone' }).returning())
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: 'u_gone', role: 'owner' })
    await db.delete(authUsers).where(eq(authUsers.id, 'u_gone'))
    expect(await db.select().from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspace.id))).toEqual([])
  })

  it('allows one pending invitation per email per workspace', async () => {
    const workspace = one(await db.insert(workspaces).values({ name: 'Invites', ownerUserId: 'nobody' }).returning())
    await db.insert(workspaceInvitations).values({ workspaceId: workspace.id, email: 'sam@example.com' })
    await expect(
      db.insert(workspaceInvitations).values({ workspaceId: workspace.id, email: 'sam@example.com' }),
    ).rejects.toThrow()
  })
})
