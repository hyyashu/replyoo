import { contacts, flowRuns, messages } from '@replyooo/db'
import { createFacebookAdapter, createInstagramAdapter } from '@replyooo/meta'
import type { FlowDefinition } from '@replyooo/shared'
import type { Worker } from 'bullmq'
import { and, eq } from 'drizzle-orm'
import { Redis } from 'ioredis'
import { createHmac, randomUUID } from 'node:crypto'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest'
import type { Deps } from '../src/deps'
import type { Queues } from '../src/queues'
import { closeQueues, createBullJobs, createQueues, startWorkers } from '../src/queues'
import { createRedisRateLimiter } from '../src/rate-limit'
import { createServer } from '../src/server'
import { publishAutomation, seedAccount, TOKEN_KEY, useDb } from './support'

const SECRET = 'ig-secret'
const sent: { path: string; body: any }[] = []
const realFetch = globalThis.fetch

/**
 * Fake Instagram Graph API. msw isn't used here: its Node interceptors also hook
 * raw sockets, which breaks the postgres.js connection in the same process.
 */
async function fakeGraph(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init)
  const url = new URL(request.url)
  if (url.origin !== 'https://graph.instagram.com') return realFetch(input, init)
  const [, , id, edge] = url.pathname.split('/')
  if (request.method === 'POST' && edge === 'messages') {
    sent.push({ path: 'messages', body: await request.json() })
    return Response.json({ message_id: `mid.out.${sent.length}` })
  }
  if (request.method === 'POST' && edge === 'replies') {
    sent.push({ path: `replies:${id}`, body: await request.json() })
    return Response.json({ id: `reply.${sent.length}` })
  }
  if (request.method === 'GET' && edge === undefined) {
    return Response.json({ name: 'Priya Sharma', username: 'priya' })
  }
  return Response.json({ error: { message: `Unexpected ${request.method} ${url.pathname}`, code: 100 } }, { status: 400 })
}

const flow: FlowDefinition = {
  trigger: {
    type: 'comment_keyword',
    posts: { mode: 'any' },
    keywords: ['guide'],
    match: 'contains',
    publicReplies: ['Check your DMs!'],
  },
  start: 's1',
  steps: {
    s1: { type: 'send_message', text: 'Tap below for the guide', buttons: [{ type: 'reply', id: 'b1', label: 'Send it', next: 's2' }] },
    s2: { type: 'send_message', text: 'Here you go: https://example.com/guide' },
  },
}

let queues: Queues
let workers: Worker[]
let redis: Redis
let deps: Deps

beforeAll(() => {
  vi.stubGlobal('fetch', fakeGraph)
  const redisUrl = inject('redisUrl')
  const prefix = `e2e-${randomUUID()}`
  redis = new Redis(redisUrl)
  queues = createQueues(redisUrl, prefix)
  deps = {
    db: useDb(),
    jobs: createBullJobs(queues),
    adapters: { instagram: createInstagramAdapter(), facebook: createFacebookAdapter() },
    rateLimiter: createRedisRateLimiter(redis, 50),
    tokenKey: TOKEN_KEY,
    log: pino({ level: 'silent' }),
    now: () => new Date(),
  }
  workers = startWorkers(deps, redisUrl, { prefix, concurrency: 2 })
})

afterAll(async () => {
  await Promise.all(workers.map((w) => w.close()))
  await closeQueues(queues)
  await redis.quit()
  vi.unstubAllGlobals()
})

async function waitFor<T>(check: () => Promise<T | undefined | false>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 100))
  }
}

describe('worker end to end', () => {
  it('comment → public reply + private reply → tap → DM, with duplicates ignored', async () => {
    const db = deps.db
    const { account } = await seedAccount(db)
    await publishAutomation(db, account, flow)
    const app = createServer(deps, { verifyToken: 'v', appSecrets: [SECRET] })
    const post = (payload: unknown) => {
      const body = JSON.stringify(payload)
      const signature = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`
      return app.request('/webhooks/meta', { method: 'POST', body, headers: { 'x-hub-signature-256': signature } })
    }
    const commentId = `c_${randomUUID()}`
    const commentWebhook = {
      object: 'instagram',
      entry: [
        {
          id: account.externalId,
          time: Math.floor(Date.now() / 1000),
          changes: [
            {
              field: 'comments',
              value: { id: commentId, text: 'GUIDE please', from: { id: 'igsid_e2e', username: 'priya' }, media: { id: 'm1' } },
            },
          ],
        },
      ],
    }

    expect((await post(commentWebhook)).status).toBe(200)
    await waitFor(async () => sent.length >= 2)
    expect(sent.find((s) => s.path === `replies:${commentId}`)?.body).toEqual({ message: 'Check your DMs!' })
    const privateReply = sent.find((s) => s.path === 'messages')!
    expect(privateReply.body.recipient).toEqual({ comment_id: commentId })
    const payload: string = privateReply.body.message.attachment.payload.buttons[0].payload

    // Meta redelivers the same comment: nothing new happens.
    expect((await post(commentWebhook)).status).toBe(200)

    const now = Date.now()
    expect(
      (
        await post({
          object: 'instagram',
          entry: [
            {
              id: account.externalId,
              time: now,
              messaging: [
                {
                  sender: { id: 'igsid_e2e' },
                  recipient: { id: account.externalId },
                  timestamp: now,
                  postback: { mid: `mid.${randomUUID()}`, title: 'Send it', payload },
                },
              ],
            },
          ],
        })
      ).status,
    ).toBe(200)

    const [contact] = await waitFor(async () => {
      const rows = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.connectedAccountId, account.id), eq(contacts.platformUserId, 'igsid_e2e')))
      return rows.length > 0 && rows
    })
    const runs = await waitFor(async () => {
      const rows = await db.select().from(flowRuns).where(eq(flowRuns.contactId, contact!.id))
      return rows[0]?.status === 'completed' && rows
    })
    expect(runs).toHaveLength(1)
    await waitFor(async () => sent.length >= 3)
    expect(sent[2]?.body).toEqual({
      recipient: { id: 'igsid_e2e' },
      message: { text: 'Here you go: https://example.com/guide' },
    })

    const outbound = await db
      .select()
      .from(messages)
      .where(and(eq(messages.contactId, contact!.id), eq(messages.direction, 'out')))
    expect(outbound.map((m) => [m.kind, m.status]).sort()).toEqual(
      [
        ['comment_reply', 'sent'],
        ['dm', 'sent'],
        ['private_reply', 'sent'],
      ].sort(),
    )
    await new Promise((r) => setTimeout(r, 500))
    expect(sent).toHaveLength(3)
  })
})
