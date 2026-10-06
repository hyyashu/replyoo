import { automationVersions, automations, connectedAccounts } from '@replyooo/db'
import { encodePostback } from '@replyooo/shared'
import { eq } from 'drizzle-orm'
import { http, HttpResponse } from 'msw'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as data from '@/lib/data/automations'
import { iceBreakerItems } from '@/lib/data/ice-breakers'
import { db } from '@/lib/db'
import { DEFAULT_RECIPE, compileRecipe } from '@/lib/recipe'
import { createAccount, createWorkspace, mockFetch } from './support'

const server = mockFetch()
beforeEach(() => server.reset())
afterAll(() => server.restore())

const IG = 'https://graph.instagram.com/v24.0'

function messengerProfile(externalId: string, response: { status?: number; body?: unknown } = {}) {
  const calls: { method: string; body: unknown }[] = []
  server.use(
    http.all(`${IG}/${externalId}/messenger_profile`, async ({ request }) => {
      calls.push({ method: request.method, body: await request.json() })
      return HttpResponse.json(response.body ?? { result: 'success' }, { status: response.status ?? 200 })
    }),
  )
  return calls
}

async function setup() {
  const { workspaceId } = await createWorkspace()
  const account = await createAccount(workspaceId, 'instagram')
  return { workspaceId, account }
}

async function starters(workspaceId: string, accountId: string) {
  const automation = await data.createAutomation(workspaceId, accountId, 'conversation_starters')
  if (!automation) throw new Error('createAutomation returned null')
  return automation
}

describe('iceBreakerItems', () => {
  it('maps each question to an ice-breaker postback and ignores other triggers', () => {
    const flow = compileRecipe({
      ...DEFAULT_RECIPE,
      trigger: { type: 'ice_breaker', items: [{ question: 'Prices?', answer: 'From $9' }, { question: 'Hours?', answer: '9–5' }] },
    })
    expect(iceBreakerItems('aut-1', flow)).toEqual([
      { question: 'Prices?', payload: encodePostback({ kind: 'ice_breaker', automationId: 'aut-1', itemIndex: 0 }) },
      { question: 'Hours?', payload: encodePostback({ kind: 'ice_breaker', automationId: 'aut-1', itemIndex: 1 }) },
    ])
    expect(iceBreakerItems('aut-1', compileRecipe(DEFAULT_RECIPE))).toEqual([])
    expect(iceBreakerItems('aut-1', null)).toEqual([])
  })
})

describe('publishing conversation starters', () => {
  it('pushes the questions to Meta with ice-breaker postbacks', async () => {
    const { workspaceId, account } = await setup()
    const calls = messengerProfile(account.externalId)
    const automation = await starters(workspaceId, account.id)

    expect(await data.publishAutomation(workspaceId, automation.id)).toEqual({ ok: true, version: 1 })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      method: 'POST',
      body: {
        platform: 'instagram',
        ice_breakers: [{ locale: 'default', call_to_actions: iceBreakerItems(automation.id, automation.flow) }],
      },
    })
  })

  it('publishing a second conversation starter pauses the first', async () => {
    const { workspaceId, account } = await setup()
    messengerProfile(account.externalId)
    const first = await starters(workspaceId, account.id)
    const second = await starters(workspaceId, account.id)
    await data.publishAutomation(workspaceId, first.id)
    await data.publishAutomation(workspaceId, second.id)

    expect((await data.getAutomation(workspaceId, first.id))?.status).toBe('paused')
    expect((await data.getAutomation(workspaceId, second.id))?.status).toBe('active')
  })

  it('a Meta rejection rolls the publish back and flags a revoked token', async () => {
    const { workspaceId, account } = await setup()
    messengerProfile(account.externalId, {
      status: 400,
      body: { error: { message: 'Error validating access token', code: 190 } },
    })
    const automation = await starters(workspaceId, account.id)

    const result = await data.publishAutomation(workspaceId, automation.id)
    expect(result).toEqual({
      ok: false,
      errors: [`Meta revoked access to @${account.username}. Reconnect it in Settings, then publish again.`],
    })
    expect(await data.getAutomation(workspaceId, automation.id)).toMatchObject({ status: 'draft', version: 0 })
    expect(await db().select().from(automationVersions).where(eq(automationVersions.automationId, automation.id))).toEqual([])
    const [row] = await db().select().from(connectedAccounts).where(eq(connectedAccounts.id, account.id))
    expect(row?.status).toBe('reauth_required')
  })

  it('concurrent publishes of two conversation starters leave exactly one active', async () => {
    const { workspaceId, account } = await setup()
    messengerProfile(account.externalId)
    const first = await starters(workspaceId, account.id)
    const second = await starters(workspaceId, account.id)
    const results = await Promise.all([
      data.publishAutomation(workspaceId, first.id),
      data.publishAutomation(workspaceId, second.id),
    ])
    expect(results.every((r) => r.ok)).toBe(true)
    const statuses = [(await data.getAutomation(workspaceId, first.id))?.status, (await data.getAutomation(workspaceId, second.id))?.status]
    expect(statuses.filter((s) => s === 'active')).toHaveLength(1)
  })

  it('clears the questions when the automation is republished with another trigger', async () => {
    const { workspaceId, account } = await setup()
    const calls = messengerProfile(account.externalId)
    const automation = await starters(workspaceId, account.id)
    await data.publishAutomation(workspaceId, automation.id)
    await data.saveDraft(workspaceId, automation.id, {
      name: 'Now a keyword',
      flow: compileRecipe({ ...DEFAULT_RECIPE, opener: { ...DEFAULT_RECIPE.opener, enabled: false }, trigger: { type: 'dm_keyword', keywords: ['HI'], match: 'contains' } }),
    })
    await data.publishAutomation(workspaceId, automation.id)

    expect(calls.map((c) => c.method)).toEqual(['POST', 'DELETE'])
    expect(calls[1]?.body).toEqual({ platform: 'instagram', fields: ['ice_breakers'] })
  })

  it('replacing the live conversation starter doesn’t count against the live limit', async () => {
    const { workspaceId, account } = await setup()
    messengerProfile(account.externalId)
    const first = await starters(workspaceId, account.id)
    await data.publishAutomation(workspaceId, first.id)
    for (let i = 0; i < 2; i++) {
      const other = await data.createAutomation(workspaceId, account.id, 'comment_to_dm')
      await data.publishAutomation(workspaceId, other?.id ?? '')
    }
    const second = await starters(workspaceId, account.id)
    expect(await data.publishAutomation(workspaceId, second.id)).toEqual({ ok: true, version: 1 })
  })
})

describe('pausing, resuming and deleting conversation starters', () => {
  it('pausing clears the questions and resuming pushes them again', async () => {
    const { workspaceId, account } = await setup()
    const calls = messengerProfile(account.externalId)
    const automation = await starters(workspaceId, account.id)
    await data.publishAutomation(workspaceId, automation.id)

    expect(await data.setAutomationStatus(workspaceId, automation.id, 'paused')).toEqual({ ok: true })
    expect(await data.setAutomationStatus(workspaceId, automation.id, 'active')).toEqual({ ok: true })
    expect(calls.map((c) => c.method)).toEqual(['POST', 'DELETE', 'POST'])
  })

  it('a refused resume stays paused', async () => {
    const { workspaceId, account } = await setup()
    messengerProfile(account.externalId)
    const automation = await starters(workspaceId, account.id)
    await data.publishAutomation(workspaceId, automation.id)
    await data.setAutomationStatus(workspaceId, automation.id, 'paused')

    server.reset()
    messengerProfile(account.externalId, { status: 500, body: { error: { message: 'Temporarily unavailable', code: 2 } } })
    const result = await data.setAutomationStatus(workspaceId, automation.id, 'active')
    expect(result.ok).toBe(false)
    expect((await data.getAutomation(workspaceId, automation.id))?.status).toBe('paused')
  })

  it('deleting the live conversation starter clears the questions', async () => {
    const { workspaceId, account } = await setup()
    const calls = messengerProfile(account.externalId)
    const automation = await starters(workspaceId, account.id)
    await data.publishAutomation(workspaceId, automation.id)
    await data.deleteAutomation(workspaceId, automation.id)

    expect(calls.map((c) => c.method)).toEqual(['POST', 'DELETE'])
    expect(await db().select().from(automations).where(eq(automations.id, automation.id))).toEqual([])
  })

  it('pausing still succeeds when Meta is down', async () => {
    const { workspaceId, account } = await setup()
    messengerProfile(account.externalId)
    const automation = await starters(workspaceId, account.id)
    await data.publishAutomation(workspaceId, automation.id)

    server.reset()
    messengerProfile(account.externalId, { status: 500, body: { error: { message: 'down', code: 2 } } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await data.setAutomationStatus(workspaceId, automation.id, 'paused')).toEqual({ ok: true })
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
    expect((await data.getAutomation(workspaceId, automation.id))?.status).toBe('paused')
  })
})
