import { authUsers, connectedAccounts, encryptToken, workspaceMembers, workspaces } from '@replyooo/db'
import type { Platform } from '@replyooo/shared'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'

export const TOKEN_KEY = Buffer.alloc(32, 7)

export function one<T>(rows: T[]): T {
  const row = rows[0]
  if (!row) throw new Error('expected a row')
  return row
}

export async function createUser(overrides: { name?: string; email?: string; emailVerified?: boolean } = {}) {
  const id = randomUUID()
  return one(
    await db()
      .insert(authUsers)
      .values({
        id,
        name: overrides.name ?? 'Test User',
        email: overrides.email ?? `${id}@example.com`,
        emailVerified: overrides.emailVerified ?? false,
      })
      .returning(),
  )
}

/** A workspace with an owner, the shape resolveWorkspace creates. */
export async function createWorkspace(name = 'Acme') {
  const user = await createUser({ name: `${name} Owner` })
  const workspace = one(await db().insert(workspaces).values({ name, ownerUserId: user.id }).returning())
  await db().insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
  return { workspaceId: workspace.id, user }
}

export async function createAccount(
  workspaceId: string,
  platform: Platform = 'instagram',
  overrides: Partial<typeof connectedAccounts.$inferInsert> = {},
) {
  return one(
    await db()
      .insert(connectedAccounts)
      .values({
        workspaceId,
        platform,
        externalId: `ext_${randomUUID()}`,
        username: platform === 'instagram' ? 'maya.makes' : 'mayamakeskitchen',
        displayName: 'Maya Makes',
        followersCount: 1_200,
        accessTokenEnc: encryptToken('stored-token', TOKEN_KEY),
        ...overrides,
      })
      .returning(),
  )
}
