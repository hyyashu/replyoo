import { connectedAccounts, decryptToken, subscriptions } from '@replyooo/db'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { http, HttpResponse } from 'msw'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { completeConnect, stateMatches } from '@/lib/connect'
import { db } from '@/lib/db'
import { TOKEN_KEY, createAccount, createWorkspace, mockFetch } from './support'

const server = mockFetch()
let IG_ID = ''
beforeEach(() => {
  server.reset()
  // The database is shared across tests, so each one gets its own Instagram account ID.
  IG_ID = `1784${randomUUID().replace(/\D/g, '').padEnd(12, '0').slice(0, 12)}`
})
afterAll(() => server.restore())

function instagram(profile: Partial<{ account_type: string; followers_count: number }> = {}) {
  const subscribed: string[] = []
  server.use(
    http.post('https://api.instagram.com/oauth/access_token', () => HttpResponse.json({ data: [{ access_token: 'IG_SHORT' }] })),
    http.get('https://graph.instagram.com/access_token', () =>
      HttpResponse.json({ access_token: 'IG_LONG', expires_in: 5_184_000 }),
    ),
    http.get('https://graph.instagram.com/v24.0/me', () =>
      HttpResponse.json({
        id: `IGSU_${IG_ID}`,
        user_id: IG_ID,
        username: 'maya.makes',
        name: 'Maya Makes',
        account_type: 'BUSINESS',
        followers_count: 412000,
        ...profile,
      }),
    ),
    http.post(`https://graph.instagram.com/v24.0/${IG_ID}/subscribed_apps`, ({ request }) => {
      subscribed.push(new URL(request.url).searchParams.get('subscribed_fields') ?? '')
      return HttpResponse.json({ success: true })
    }),
  )
  return subscribed
}

async function accountsFor(workspaceId: string) {
  return db().select().from(connectedAccounts).where(eq(connectedAccounts.workspaceId, workspaceId))
}

describe('stateMatches', () => {
  it('requires the same platform and nonce', () => {
    expect(stateMatches('instagram:abc', 'instagram', 'abc')).toBe(true)
    expect(stateMatches('instagram:abc', 'facebook', 'abc')).toBe(false)
    expect(stateMatches('instagram:abc', 'instagram', 'abd')).toBe(false)
    expect(stateMatches(undefined, 'instagram', 'abc')).toBe(false)
    expect(stateMatches('instagram:abc', 'instagram', null)).toBe(false)
  })
})

describe('connecting Instagram', () => {
  it('stores the account with an encrypted long-lived token and subscribes webhooks', async () => {
    const { workspaceId, user } = await createWorkspace('IG')
    const subscribed = instagram()

    const result = await completeConnect(db(), 'instagram', workspaceId, user.id, 'CODE')
    expect(result.ok).toBe(true)
    const [account] = await accountsFor(workspaceId)
    expect(account).toMatchObject({
      platform: 'instagram',
      externalId: IG_ID,
      username: 'maya.makes',
      followersCount: 412000,
      status: 'active',
      connectedByUserId: user.id,
      metaUserId: `IGSU_${IG_ID}`,
    })
    expect(account && decryptToken(account.accessTokenEnc, TOKEN_KEY)).toBe('IG_LONG')
    expect(account?.tokenExpiresAt).toBeInstanceOf(Date)
    expect(subscribed).toEqual(['comments,messages,messaging_postbacks'])
  })

  it('rejects personal accounts without saving anything', async () => {
    const { workspaceId, user } = await createWorkspace('Personal')
    const subscribed = instagram({ account_type: 'PERSONAL' })
    expect(await completeConnect(db(), 'instagram', workspaceId, user.id, 'CODE')).toEqual({ ok: false, error: 'personal_account' })
    expect(await accountsFor(workspaceId)).toEqual([])
    expect(subscribed).toEqual([])
  })

  it('rejects a missing account type without saving anything', async () => {
    const { workspaceId, user } = await createWorkspace('NoType')
    const subscribed = instagram()
    server.use(
      http.get('https://graph.instagram.com/v24.0/me', () =>
        HttpResponse.json({ user_id: IG_ID, username: 'maya.makes', name: 'Maya Makes', account_type: null }),
      ),
    )
    expect(await completeConnect(db(), 'instagram', workspaceId, user.id, 'CODE')).toEqual({ ok: false, error: 'personal_account' })
    expect(await accountsFor(workspaceId)).toEqual([])
    expect(subscribed).toEqual([])
  })

  it('accepts a media creator account', async () => {
    const { workspaceId, user } = await createWorkspace('Creator')
    instagram({ account_type: 'MEDIA_CREATOR' })
    expect((await completeConnect(db(), 'instagram', workspaceId, user.id, 'CODE')).ok).toBe(true)
  })

  it('reconnecting refreshes the token and reactivates the same row', async () => {
    const { workspaceId, user } = await createWorkspace('Again')
    const existing = await createAccount(workspaceId, 'instagram', { externalId: IG_ID, status: 'reauth_required' })
    instagram({ followers_count: 500000 })

    expect(await completeConnect(db(), 'instagram', workspaceId, user.id, 'CODE')).toEqual({ ok: true, accountIds: [existing.id], limited: false })
    const rows = await accountsFor(workspaceId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: existing.id, status: 'active', followersCount: 500000 })
    expect(rows[0] && decryptToken(rows[0].accessTokenEnc, TOKEN_KEY)).toBe('IG_LONG')
  })

  it('refuses an account owned by another workspace and leaves it untouched', async () => {
    const owner = await createWorkspace('Owner')
    const intruder = await createWorkspace('Intruder')
    const existing = await createAccount(owner.workspaceId, 'instagram', { externalId: IG_ID })
    const subscribed = instagram()

    expect(await completeConnect(db(), 'instagram', intruder.workspaceId, intruder.user.id, 'CODE')).toEqual({
      ok: false,
      error: 'owned_elsewhere',
    })
    const [row] = await db().select().from(connectedAccounts).where(eq(connectedAccounts.id, existing.id))
    expect(row?.workspaceId).toBe(owner.workspaceId)
    expect(row && decryptToken(row.accessTokenEnc, TOKEN_KEY)).toBe('stored-token')
    expect(subscribed).toEqual([])
  })

  it('reports Meta failures without saving', async () => {
    const { workspaceId, user } = await createWorkspace('Broken')
    server.use(
      http.post('https://api.instagram.com/oauth/access_token', () =>
        HttpResponse.json({ error_type: 'OAuthException', code: 400, error_message: 'Invalid code' }, { status: 400 }),
      ),
    )
    expect(await completeConnect(db(), 'instagram', workspaceId, user.id, 'BAD')).toEqual({ ok: false, error: 'meta_error' })
    expect(await accountsFor(workspaceId)).toEqual([])
  })

  it('refuses a second account on Free before subscribing webhooks', async () => {
    const { workspaceId, user } = await createWorkspace('FullIG')
    await createAccount(workspaceId, 'facebook', { externalId: `page_${randomUUID()}` })
    const subscribed = instagram()
    expect(await completeConnect(db(), 'instagram', workspaceId, user.id, 'CODE')).toEqual({ ok: false, error: 'plan_limit' })
    expect(subscribed).toEqual([])
  })

  it('a disconnected account doesn’t take a slot', async () => {
    const { workspaceId, user } = await createWorkspace('Slots')
    await createAccount(workspaceId, 'facebook', { externalId: `page_${randomUUID()}`, status: 'disconnected' })
    instagram()
    expect((await completeConnect(db(), 'instagram', workspaceId, user.id, 'CODE')).ok).toBe(true)
  })
})

describe('connecting Facebook Pages', () => {
  function facebook(pages: { id: string; name: string; access_token?: string }[]) {
    const subscribed: string[] = []
    server.use(
      http.get('https://graph.facebook.com/v24.0/oauth/access_token', ({ request }) =>
        HttpResponse.json({
          access_token: new URL(request.url).searchParams.get('grant_type') === 'fb_exchange_token' ? 'FB_LONG' : 'FB_SHORT',
        }),
      ),
      http.get('https://graph.facebook.com/v24.0/me', () => HttpResponse.json({ id: 'FBU_42' })),
      http.get('https://graph.facebook.com/v24.0/me/accounts', () => HttpResponse.json({ data: pages })),
      http.post('https://graph.facebook.com/v24.0/:pageId/subscribed_apps', ({ params }) => {
        subscribed.push(String(params.pageId))
        return HttpResponse.json({ success: true })
      }),
    )
    return subscribed
  }

  it('connects every granted Page and skips ones owned elsewhere', async () => {
    const other = await createWorkspace('Other')
    await createAccount(other.workspaceId, 'facebook', { externalId: 'page_taken' })
    const { workspaceId, user } = await createWorkspace('Pages')
    const subscribed = facebook([
      { id: 'page_a', name: 'Page A', access_token: 'PA' },
      { id: 'page_taken', name: 'Taken', access_token: 'PT' },
    ])

    const result = await completeConnect(db(), 'facebook', workspaceId, user.id, 'FBCODE')
    expect(result.ok && result.accountIds).toHaveLength(1)
    const rows = await accountsFor(workspaceId)
    expect(rows.map((r) => [r.externalId, r.tokenExpiresAt])).toEqual([['page_a', null]])
    expect(rows[0]?.metaUserId).toBe('FBU_42')
    expect(subscribed).toEqual(['page_a'])
  })

  it('reports when no Page was granted', async () => {
    const { workspaceId, user } = await createWorkspace('NoPages')
    facebook([])
    expect(await completeConnect(db(), 'facebook', workspaceId, user.id, 'FBCODE')).toEqual({ ok: false, error: 'no_pages' })
  })

  it('connects Pages up to the plan limit and reports the rest as limited', async () => {
    const { workspaceId, user } = await createWorkspace('ManyPages')
    const subscribed = facebook([
      { id: `page_${randomUUID()}`, name: 'One', access_token: 'P1' },
      { id: `page_${randomUUID()}`, name: 'Two', access_token: 'P2' },
    ])
    const result = await completeConnect(db(), 'facebook', workspaceId, user.id, 'FBCODE')
    expect(result).toMatchObject({ ok: true, limited: true })
    expect(result.ok && result.accountIds).toHaveLength(1)
    expect(subscribed).toHaveLength(1)

    await db().insert(subscriptions).values({ workspaceId, plan: 'pro', status: 'active' })
    facebook([{ id: `page_${randomUUID()}`, name: 'Three', access_token: 'P3' }])
    expect(await completeConnect(db(), 'facebook', workspaceId, user.id, 'FBCODE')).toMatchObject({ ok: true, limited: false })
  })

  it('reports plan_limit when no Page fits', async () => {
    const { workspaceId, user } = await createWorkspace('NoRoom')
    await createAccount(workspaceId, 'instagram')
    facebook([{ id: `page_${randomUUID()}`, name: 'One', access_token: 'P1' }])
    expect(await completeConnect(db(), 'facebook', workspaceId, user.id, 'FBCODE')).toEqual({ ok: false, error: 'plan_limit' })
  })
})
