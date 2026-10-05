import 'server-only'
import { createDb, type Db } from '@replyooo/db'
import { env } from './env'

type Handle = ReturnType<typeof createDb>
const store = globalThis as { __replyoooDb?: Handle }

/** One pool per process, kept on globalThis so dev-server reloads don't open new pools. */
export function db(): Db {
  store.__replyoooDb ??= createDb(env().DATABASE_URL)
  return store.__replyoooDb.db
}

export async function closeDb(): Promise<void> {
  await store.__replyoooDb?.close()
  store.__replyoooDb = undefined
}
