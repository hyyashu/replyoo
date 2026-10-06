import { automations, connectedAccounts, contacts } from '@replyooo/db'
import { eq } from 'drizzle-orm'
import { http, HttpResponse } from 'msw'
import { createHmac, randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as dataDeletion } from '@/app/api/meta/data-deletion/route'
import { POST as deauthorize } from '@/app/api/meta/deauthorize/route'
import { createAutomation, publishAutomation } from '@/lib/data/automations'
import { findDeletionRequest, ICE_BREAKER_CLEAR_BUDGET_MS } from '@/lib/meta-callbacks'
import { db } from '@/lib/db'
import { createAccount, createContact, createWorkspace, mockFetch } from './support'

const server = mockFetch()
beforeEach(() => server.reset())
afterAll(() => server.restore())

// test/setup.ts sets META_APP_SECRET=fb-secret and INSTAGRAM_APP_SECRET=ig-secret.
function signed(userId: string, secret: string) {
  const body = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: userId, issued_at: 1_790_000_000 })).toString('base64url')
  return `${createHmac('sha256', secret).update(body).digest('base64url')}.${body}`
}

function post(signedRequest: string) {
  return new Request('http://localhost:3000/api/meta/callback', {
    method: 'POST',
    body: new URLSearchParams({ signed_request: signedRequest }),
  })
}

async function account(id: string) {
  const [row] = await db().select().from(connectedAccounts).where(eq(connectedAccounts.id, id))
  return row
}

/** An Instagram account granted by `igUser` with a published, live conversation-starters automation. */
function messengerProfile(externalId: string, status = 200) {
  const calls: string[] = []
  server.use(
    http.all(`https://graph.instagram.com/v24.0/${externalId}/messenger_profile`, ({ request }) => {
      calls.push(request.method)
      return HttpResponse.json(status === 200 ? { result: 'success' } : { error: { message: 'boom', code: 2 } }, { status })
    }),
  )
  return calls
}

async function liveStarters(igUser: string) {
  const { workspaceId } = await createWorkspace('Starters')
  const ig = await createAccount(workspaceId, 'instagram', { metaUserId: igUser })
  const calls = messengerProfile(ig.externalId)
  const automation = await createAutomation(workspaceId, ig.id, 'conversation_starters')
  if (!automation) throw new Error('no automation')
  expect(await publishAutomation(workspaceId, automation.id)).toEqual({ ok: true, version: 1 })
  calls.length = 0
  return { ig, automation, calls }
}

describe('Meta data-deletion callback', () => {
  it('deletes the Facebook user’s accounts and their data, and returns a status link', async () => {
    const userId = `fbu_${randomUUID()}`
    const { workspaceId } = await createWorkspace('Deleter')
    const page = await createAccount(workspaceId, 'facebook', { metaUserId: userId })
    const contact = await createContact(workspaceId, page.id)
    const someoneElse = await createAccount(workspaceId, 'facebook', { metaUserId: `fbu_${randomUUID()}` })

    const response = await dataDeletion(post(signed(userId, 'fb-secret')))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { url: string; confirmation_code: string }
    expect(body.confirmation_code).toMatch(/^[0-9a-f]{16}$/)
    expect(body.url).toBe(`http://localhost:3000/data-deletion/status?code=${body.confirmation_code}`)

    expect(await account(page.id)).toBeUndefined()
    expect(await db().select().from(contacts).where(eq(contacts.id, contact.id))).toEqual([])
    expect(await account(someoneElse.id)).toBeDefined()
    expect(await findDeletionRequest(db(), body.confirmation_code)).toMatchObject({ accountsDeleted: 1 })
  })

  it('matches Instagram accounts by the app-scoped id or the account id', async () => {
    const igUser = `igu_${randomUUID()}`
    const { workspaceId } = await createWorkspace('IGDeleter')
    const byMetaUser = await createAccount(workspaceId, 'instagram', { metaUserId: igUser })
    const byExternal = await createAccount(workspaceId, 'instagram', { externalId: igUser })

    await dataDeletion(post(signed(igUser, 'ig-secret')))
    expect(await account(byMetaUser.id)).toBeUndefined()
    expect(await account(byExternal.id)).toBeUndefined()
  })

  it('rejects a request with a bad signature and deletes nothing', async () => {
    const userId = `fbu_${randomUUID()}`
    const { workspaceId } = await createWorkspace('Forged')
    const page = await createAccount(workspaceId, 'facebook', { metaUserId: userId })

    expect((await dataDeletion(post(signed(userId, 'wrong-secret')))).status).toBe(400)
    expect((await dataDeletion(new Request('http://localhost:3000/x', { method: 'POST', body: 'nonsense' }))).status).toBe(400)
    expect(await account(page.id)).toBeDefined()
  })

  it('clears live conversation starters on Meta before deleting', async () => {
    const igUser = `igu_${randomUUID()}`
    const { ig, automation, calls } = await liveStarters(igUser)

    expect((await dataDeletion(post(signed(igUser, 'ig-secret')))).status).toBe(200)
    expect(calls).toEqual(['DELETE'])
    expect(await account(ig.id)).toBeUndefined()
    expect(await db().select().from(automations).where(eq(automations.id, automation.id))).toEqual([])
  })

  it('still deletes when Meta fails to clear the conversation starters', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const igUser = `igu_${randomUUID()}`
    const { ig } = await liveStarters(igUser)
    const calls = messengerProfile(ig.externalId, 500)

    expect((await dataDeletion(post(signed(igUser, 'ig-secret')))).status).toBe(200)
    expect(calls).toEqual(['DELETE'])
    expect(warn).toHaveBeenCalled()
    expect(await account(ig.id)).toBeUndefined()
    warn.mockRestore()
  })
})

describe('Meta callbacks with a slow Graph API', () => {
  it('answers Meta within the budget even when clearing conversation starters hangs', async () => {
    const igUser = `igu_${randomUUID()}`
    const { ig, automation } = await liveStarters(igUser)
    let release = () => {}
    const hung = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.all(`https://graph.instagram.com/v24.0/${ig.externalId}/messenger_profile`, async () => {
        await hung
        return HttpResponse.json({ result: 'success' })
      }),
    )

    const started = Date.now()
    expect((await dataDeletion(post(signed(igUser, 'ig-secret')))).status).toBe(200)
    expect(Date.now() - started).toBeLessThan(ICE_BREAKER_CLEAR_BUDGET_MS + 2_000)
    expect(await account(ig.id)).toBeUndefined()
    expect(await db().select().from(automations).where(eq(automations.id, automation.id))).toEqual([])
    release()
  }, 15_000)
})

describe('Meta deauthorize callback', () => {
  it('marks the user’s accounts disconnected and keeps their data', async () => {
    const userId = `fbu_${randomUUID()}`
    const { workspaceId } = await createWorkspace('Remover')
    const page = await createAccount(workspaceId, 'facebook', { metaUserId: userId })
    const contact = await createContact(workspaceId, page.id)

    expect((await deauthorize(post(signed(userId, 'fb-secret')))).status).toBe(200)
    expect(await account(page.id)).toMatchObject({ status: 'disconnected' })
    expect(await db().select().from(contacts).where(eq(contacts.id, contact.id))).toHaveLength(1)
  })

  it('a Facebook-signed request never touches Instagram accounts', async () => {
    const userId = `shared_${randomUUID()}`
    const { workspaceId } = await createWorkspace('CrossPlatform')
    const ig = await createAccount(workspaceId, 'instagram', { metaUserId: userId })
    await deauthorize(post(signed(userId, 'fb-secret')))
    expect(await account(ig.id)).toMatchObject({ status: 'active' })
  })

  it('rejects a request with a bad signature and disconnects nothing', async () => {
    const userId = `fbu_${randomUUID()}`
    const { workspaceId } = await createWorkspace('ForgedRemover')
    const page = await createAccount(workspaceId, 'facebook', { metaUserId: userId })
    expect((await deauthorize(post(signed(userId, 'wrong-secret')))).status).toBe(400)
    expect(await account(page.id)).toMatchObject({ status: 'active' })
  })

  it('clears live conversation starters like a manual disconnect', async () => {
    const igUser = `igu_${randomUUID()}`
    const { ig, calls } = await liveStarters(igUser)

    expect((await deauthorize(post(signed(igUser, 'ig-secret')))).status).toBe(200)
    expect(calls).toEqual(['DELETE'])
    expect(await account(ig.id)).toMatchObject({ status: 'disconnected' })
  })
})
