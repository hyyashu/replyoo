import {
  authUsers,
  automations,
  connectedAccounts,
  contacts,
  encryptToken,
  flowRuns,
  messages,
  workspaceMembers,
  workspaces,
} from '@replyooo/db'
import type { Platform } from '@replyooo/shared'
import { eq } from 'drizzle-orm'
import { type RequestHandler, getResponse } from 'msw'
import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'
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

export async function createContact(
  workspaceId: string,
  accountId: string,
  overrides: Partial<typeof contacts.$inferInsert> = {},
) {
  return one(
    await db()
      .insert(contacts)
      .values({
        workspaceId,
        connectedAccountId: accountId,
        platformUserId: `psid_${randomUUID()}`,
        username: 'priya',
        name: 'Priya Sharma',
        lastInboundAt: new Date(),
        ...overrides,
      })
      .returning(),
  )
}

/** A run of the automation's current (published) version. */
export async function createRun(input: {
  automationId: string
  contactId: string
  accountId: string
  status?: (typeof flowRuns.$inferInsert)['status']
  createdAt?: Date
}) {
  const [automation] = await db()
    .select({ versionId: automations.currentVersionId })
    .from(automations)
    .where(eq(automations.id, input.automationId))
  if (!automation?.versionId) throw new Error('publish the automation before creating runs')
  return one(
    await db()
      .insert(flowRuns)
      .values({
        automationId: input.automationId,
        automationVersionId: automation.versionId,
        contactId: input.contactId,
        connectedAccountId: input.accountId,
        status: input.status ?? 'completed',
        createdAt: input.createdAt ?? new Date(),
      })
      .returning(),
  )
}

export async function createMessage(input: {
  contactId: string
  accountId: string
  runId?: string | null
  direction?: 'in' | 'out'
  kind?: (typeof messages.$inferInsert)['kind']
  status?: (typeof messages.$inferInsert)['status']
  body?: Record<string, unknown>
  createdAt?: Date
}) {
  const direction = input.direction ?? 'out'
  return one(
    await db()
      .insert(messages)
      .values({
        contactId: input.contactId,
        connectedAccountId: input.accountId,
        flowRunId: input.runId ?? null,
        direction,
        kind: input.kind ?? 'dm',
        status: input.status ?? (direction === 'in' ? 'received' : 'sent'),
        body: input.body ?? { type: 'message', message: { text: 'Here you go!' } },
        createdAt: input.createdAt ?? new Date(),
      })
      .returning(),
  )
}

/**
 * Stubs global `fetch` and answers from msw handlers. Unmatched requests reject, like `onUnhandledFrame: 'error'`.
 * msw's `setupServer` patches `net.Socket`, which breaks Postgres connections opened while it is listening.
 */
export function mockFetch(...initial: RequestHandler[]) {
  let handlers = initial
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const response = await getResponse(handlers, request)
    if (!response) throw new Error(`Unhandled ${request.method} ${request.url}`)
    return response
  })
  return {
    use(...next: RequestHandler[]) {
      handlers = [...next, ...handlers]
    },
    reset() {
      handlers = initial
    },
    restore() {
      vi.unstubAllGlobals()
    },
  }
}
