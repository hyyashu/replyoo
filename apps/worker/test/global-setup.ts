import { createDb } from '@replyooo/db'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer } from '@testcontainers/redis'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { fileURLToPath } from 'node:url'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string
    redisUrl: string
  }
}

export default async function setup(project: TestProject) {
  const postgres = await new PostgreSqlContainer('postgres:18-alpine').start()
  const redis = await new RedisContainer('redis:7-alpine').start()
  const databaseUrl = postgres.getConnectionUri()

  const { db, close } = createDb(databaseUrl)
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)),
  })
  await close()

  project.provide('databaseUrl', databaseUrl)
  project.provide('redisUrl', redis.getConnectionUrl())

  return async () => {
    await redis.stop()
    await postgres.stop()
  }
}
