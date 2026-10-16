import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ fail: false }))

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>()
  return {
    ...actual,
    db: () => {
      if (state.fail) throw new Error('connection refused')
      return actual.db()
    },
  }
})

const { GET } = await import('@/app/api/health/route')

afterEach(() => {
  state.fail = false
})

describe('GET /api/health', () => {
  it('answers 200 when the database responds', async () => {
    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ ok: true })
  })

  it('answers 503 without details when the database is unreachable', async () => {
    state.fail = true
    const response = await GET()
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ ok: false })
  })
})
