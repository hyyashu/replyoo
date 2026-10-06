import { describe, expect, it } from 'vitest'
import { loadEnv } from '../src/env'

const required = {
  DATABASE_URL: 'postgres://x',
  REDIS_URL: 'redis://x',
  TOKEN_ENCRYPTION_KEY: 'a2V5',
  META_APP_SECRET: 's1',
  INSTAGRAM_APP_SECRET: 's2',
  META_WEBHOOK_VERIFY_TOKEN: 'v',
  APP_URL: 'http://localhost:3000',
}

describe('loadEnv', () => {
  it('applies defaults', () => {
    expect(loadEnv(required)).toMatchObject({
      META_GRAPH_VERSION: 'v24.0',
      PORT: 3001,
      OUTBOUND_RATE_PER_SECOND: 10,
      LOG_LEVEL: 'info',
    })
  })

  it('coerces numbers and rejects missing secrets', () => {
    expect(loadEnv({ ...required, PORT: '8080' }).PORT).toBe(8080)
    expect(() => loadEnv({ ...required, META_APP_SECRET: undefined })).toThrow()
  })

  it('requires the web origin for email links', () => {
    expect(() => loadEnv({ ...required, APP_URL: undefined })).toThrow()
  })
})
