import { createDb } from '@replyooo/db'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { fileURLToPath } from 'node:url'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string
  }
}

export default async function setup(project: TestProject) {
  const postgres = await new PostgreSqlContainer('postgres:18-alpine').start()
  const databaseUrl = postgres.getConnectionUri()

  const { db, close } = createDb(databaseUrl)
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)),
  })
  await close()

  project.provide('databaseUrl', databaseUrl)
  return async () => {
    await postgres.stop()
  }
}
