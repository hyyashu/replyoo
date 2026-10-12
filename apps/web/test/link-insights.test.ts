import { linkClicks, trackedLinks } from '@replyooo/db'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import * as data from '@/lib/data/automations'
import { db } from '@/lib/db'
import { createAccount, createContact, createMessage, createRun, createWorkspace } from './support'

async function setup() {
  const { workspaceId } = await createWorkspace()
  const account = await createAccount(workspaceId)
  const automation = await data.createAutomation(workspaceId, account.id, 'comment_to_dm')
  if (!automation) throw new Error('createAutomation returned null')
  await data.publishAutomation(workspaceId, automation.id)
  return { workspaceId, accountId: account.id, automationId: automation.id }
}

async function sendLink(ctx: Awaited<ReturnType<typeof setup>>, url: string, clicks: number) {
  const contact = await createContact(ctx.workspaceId, ctx.accountId)
  const run = await createRun({ automationId: ctx.automationId, contactId: contact.id, accountId: ctx.accountId })
  const message = await createMessage({ contactId: contact.id, accountId: ctx.accountId, runId: run.id, kind: 'dm' })
  const [link] = await db()
    .insert(trackedLinks)
    .values({ code: randomUUID().replace(/-/g, '').slice(0, 8), messageId: message.id, position: 0, url, contactId: contact.id, automationId: ctx.automationId })
    .returning()
  for (let i = 0; i < clicks; i++) await db().insert(linkClicks).values({ linkId: link!.id })
}

describe('linkInsights', () => {
  it('lists each destination with recipients, clickers and clicks', async () => {
    const ctx = await setup()
    await sendLink(ctx, 'https://example.com/guide', 2)
    await sendLink(ctx, 'https://example.com/guide', 0)
    await sendLink(ctx, 'https://example.com/other', 0)
    expect(await data.linkInsights(ctx.workspaceId, ctx.automationId)).toEqual([
      { url: 'https://example.com/guide', recipients: 2, clickers: 1, clicks: 2 },
      { url: 'https://example.com/other', recipients: 1, clickers: 0, clicks: 0 },
    ])
  })

  it('returns an empty list when no link was sent', async () => {
    const ctx = await setup()
    expect(await data.linkInsights(ctx.workspaceId, ctx.automationId)).toEqual([])
  })

  it('returns null for an automation in another workspace, a malformed id or an unknown id', async () => {
    const ctx = await setup()
    const other = await createWorkspace('Other')
    expect(await data.linkInsights(other.workspaceId, ctx.automationId)).toBeNull()
    expect(await data.linkInsights(ctx.workspaceId, 'not-a-uuid')).toBeNull()
    expect(await data.linkInsights(ctx.workspaceId, randomUUID())).toBeNull()
  })
})

describe('linkDaily', () => {
  it('returns 14 days of clicks for one destination', async () => {
    const ctx = await setup()
    await sendLink(ctx, 'https://example.com/guide', 3)
    const days = await data.linkDaily(ctx.workspaceId, ctx.automationId, 'https://example.com/guide')
    expect(days).toHaveLength(14)
    expect(days?.at(-1)?.clicks).toBe(3)
  })

  it('returns null for an automation in another workspace', async () => {
    const ctx = await setup()
    const other = await createWorkspace('Other')
    expect(await data.linkDaily(other.workspaceId, ctx.automationId, 'https://example.com/guide')).toBeNull()
  })
})
