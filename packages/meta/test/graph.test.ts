import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { graphRequest, MetaError } from '../src'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const base = 'https://graph.example.test/v24.0'

describe('graphRequest', () => {
  it('sends bearer auth, query and JSON body', async () => {
    let seen: { auth: string | null; query: string | null; body: unknown; type: string | null } | undefined
    server.use(
      http.post(`${base}/123/messages`, async ({ request }) => {
        seen = {
          auth: request.headers.get('authorization'),
          query: new URL(request.url).searchParams.get('fields'),
          type: request.headers.get('content-type'),
          body: await request.json(),
        }
        return HttpResponse.json({ message_id: 'mid.1' })
      }),
    )
    const result = await graphRequest<{ message_id: string }>({
      baseUrl: base,
      path: '/123/messages',
      token: 'tok',
      method: 'POST',
      query: { fields: 'id' },
      body: { hello: 'world' },
    })
    expect(result).toEqual({ message_id: 'mid.1' })
    expect(seen).toEqual({ auth: 'Bearer tok', query: 'id', type: 'application/json', body: { hello: 'world' } })
  })

  it('throws classified MetaErrors for Graph errors', async () => {
    server.use(
      http.get(`${base}/me`, () =>
        HttpResponse.json({ error: { message: 'Session expired', code: 190 } }, { status: 400 }),
      ),
    )
    const error = await graphRequest({ baseUrl: base, path: 'me', token: 'tok' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MetaError)
    expect((error as MetaError).kind).toBe('reauth')
  })

  it('treats network failures as retryable', async () => {
    server.use(http.get(`${base}/me`, () => HttpResponse.error()))
    const error = await graphRequest({ baseUrl: base, path: 'me', token: 'tok' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MetaError)
    expect((error as MetaError).kind).toBe('retryable')
    expect((error as MetaError).details.reason).toBe('network')
  })

  it('returns an empty object for empty success bodies', async () => {
    server.use(http.delete(`${base}/x`, () => new HttpResponse(null, { status: 200 })))
    await expect(graphRequest({ baseUrl: base, path: 'x', token: 't', method: 'DELETE' })).resolves.toEqual({})
  })

  it('omits the Authorization header when no token is given', async () => {
    let auth: string | null = 'unset'
    server.use(
      http.get(`${base}/thing`, ({ request }) => {
        auth = request.headers.get('authorization')
        return HttpResponse.json({ ok: true })
      }),
    )
    await graphRequest({ baseUrl: base, path: 'thing' })
    expect(auth).toBeNull()
  })

  it('sends Authorization header even for empty string token', async () => {
    let auth: string | null = 'unset'
    server.use(
      http.get(`${base}/thing`, ({ request }) => {
        auth = request.headers.get('authorization')
        return HttpResponse.json({ ok: true })
      }),
    )
    await graphRequest({ baseUrl: base, path: 'thing', token: '' })
    expect(auth).not.toBeNull()
    expect(auth?.startsWith('Bearer')).toBe(true)
  })
})
