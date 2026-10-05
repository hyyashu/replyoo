import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { isUuid } from '@/lib/data/ids'
import { db } from '@/lib/db'
import { parseEnv } from '@/lib/env'

const base = {
  DATABASE_URL: 'postgres://localhost/replyooo',
  APP_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  TOKEN_ENCRYPTION_KEY: 'key',
  META_APP_ID: 'fb-app',
  META_APP_SECRET: 'fb-secret',
  INSTAGRAM_APP_ID: 'ig-app',
  INSTAGRAM_APP_SECRET: 'ig-secret',
}

describe('parseEnv', () => {
  it('treats blank optional values as unset and defaults the Graph version', () => {
    const env = parseEnv({ ...base, GOOGLE_CLIENT_ID: '', META_LOGIN_CONFIG_ID: '', META_GRAPH_VERSION: '' })
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined()
    expect(env.META_LOGIN_CONFIG_ID).toBeUndefined()
    expect(env.META_GRAPH_VERSION).toBe('v24.0')
  })

  it('rejects a short auth secret and a missing Meta app', () => {
    expect(() => parseEnv({ ...base, BETTER_AUTH_SECRET: 'short' })).toThrow()
    expect(() => parseEnv({ ...base, META_APP_ID: '' })).toThrow()
  })
})

describe('isUuid', () => {
  it('accepts uuids and rejects demo ids', () => {
    expect(isUuid('0199b3a4-7c1e-7d2a-9f00-3c5e8a1b2c3d')).toBe(true)
    expect(isUuid('aut_breakfast')).toBe(false)
    expect(isUuid('')).toBe(false)
  })
})

describe('db', () => {
  it('connects to the migrated test database', async () => {
    const rows = await db().execute(sql`select count(*)::int as n from "user"`)
    expect(rows[0]).toHaveProperty('n')
  })
})
