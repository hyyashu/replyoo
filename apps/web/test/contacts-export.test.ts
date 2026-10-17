import { contacts } from '@replyooo/db'
import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/contacts/export/route'
import { db } from '@/lib/db'
import { createAccount, createWorkspace } from './support'

const context = vi.hoisted(() => ({
  workspaceId: '',
  accountId: '',
  failOnCall: 0,
  calls: 0,
}))
vi.mock('@/lib/session', () => ({
  getCurrentAccount: async () => ({
    workspace: { workspaceId: context.workspaceId },
    account: { id: context.accountId, username: 'maya.makes' },
    accounts: [],
  }),
}))
vi.mock('@/lib/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data')>()
  return {
    ...actual,
    listContacts: async (...args: Parameters<typeof actual.listContacts>) => {
      context.calls++
      if (context.calls === context.failOnCall) throw new Error('boom')
      return actual.listContacts(...args)
    },
  }
})

const TOTAL = 2050
const request = () => new Request('http://localhost/api/contacts/export')

async function seed() {
  const { workspaceId } = await createWorkspace()
  const account = await createAccount(workspaceId)
  context.workspaceId = workspaceId
  context.accountId = account.id
  const base = Date.now() - TOTAL * 60_000
  const rows = Array.from({ length: TOTAL }, (_, i) => ({
    workspaceId,
    connectedAccountId: account.id,
    platformUserId: `igsid_${i}`,
    username: `user_${i}`,
    lastInboundAt: new Date(base + i * 60_000),
  }))
  for (let i = 0; i < rows.length; i += 500) await db().insert(contacts).values(rows.slice(i, i + 500))
}

async function readAll(reader: ReadableStreamDefaultReader<Uint8Array>, decoder: TextDecoder) {
  let text = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return text
    text += decoder.decode(value, { stream: true })
  }
}

const idleInExport = async () => {
  const rows = await db().execute<{ n: number }>(
    sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and state like 'idle in transaction%' and pid <> pg_backend_pid()`,
  )
  return Number(rows[0]?.n ?? 0)
}

beforeEach(async () => {
  context.calls = 0
  context.failOnCall = 0
  await seed()
})
afterEach(async () => {
  await vi.waitFor(async () => expect(await idleInExport()).toBe(0))
})

it('streams every contact exactly once from one snapshot, even when rows move mid-export', async () => {
  const response = await GET(request())
  expect(response.status).toBe(200)
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const first = await reader.read()
  let text = decoder.decode(first.value, { stream: true })

  // The oldest contact sits on the last page; bumping it would pull it onto page one of a fresh read.
  await db().update(contacts).set({ lastInboundAt: new Date() }).where(eq(contacts.username, 'user_0'))
  text += await readAll(reader, decoder)

  const lines = text.split('\r\n')
  expect(lines[0]).toMatch(/^username,/)
  const usernames = lines.slice(1).map((line) => line.split(',')[0])
  expect(usernames).toHaveLength(TOTAL)
  expect(new Set(usernames).size).toBe(TOTAL)
})

it('answers 500 when the first page fails', async () => {
  context.failOnCall = 1
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Export failed')
  } finally {
    log.mockRestore()
  }
})

it('errors the stream when a later page fails', async () => {
  context.failOnCall = 2
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const response = await GET(request())
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    await reader.read()
    await expect(reader.read()).rejects.toThrow('boom')
  } finally {
    log.mockRestore()
  }
})

it('releases the snapshot when the download is cancelled', async () => {
  const response = await GET(request())
  const reader = response.body!.getReader()
  await reader.read()
  await reader.cancel()
})

it('releases the snapshot when the request is aborted', async () => {
  const controller = new AbortController()
  const response = await GET(new Request('http://localhost/api/contacts/export', { signal: controller.signal }))
  expect(response.status).toBe(200)
  controller.abort()
})
