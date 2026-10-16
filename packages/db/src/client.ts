import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const DEFAULT_POOL_MAX = 10

/** `DATABASE_POOL_MAX`: connections per process (web and worker each have their own pool). Unset or empty means 10. */
export function parsePoolMax(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_POOL_MAX
  const max = Number(value.trim())
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(max) || max < 1) throw new Error(`DATABASE_POOL_MAX must be a positive integer, got "${value}"`)
  return max
}

export function createDb(url: string) {
  const client = postgres(url, {
    max: parsePoolMax(process.env.DATABASE_POOL_MAX),
    // Seconds. Close connections idle this long so a quiet process gives them back to Postgres.
    idle_timeout: 30,
    // Seconds. Fail fast when Postgres is unreachable instead of hanging a request or job.
    connect_timeout: 10,
  })
  return {
    db: drizzle(client, { schema }),
    close: () => client.end(),
  }
}

export type Db = ReturnType<typeof createDb>['db']
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
