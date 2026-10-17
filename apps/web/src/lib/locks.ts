import 'server-only'
import type { Db, Tx } from '@replyooo/db'
import { sql } from 'drizzle-orm'

/**
 * Namespaces for transaction-scoped advisory locks. The two-key form keeps locks on different kinds of
 * ids (a user id vs a workspace id) from colliding when their hashes happen to match.
 */
export const LOCK_NS = { userWorkspaces: 1, workspaceLimits: 2 } as const

/** Blocks until this transaction holds the advisory lock; released at commit/rollback. Reentrant. */
export async function advisoryXactLock(tx: Db | Tx, ns: (typeof LOCK_NS)[keyof typeof LOCK_NS], key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${ns}::int4, hashtext(${key}))`)
}

/**
 * Serialises plan-limit checks for one workspace. Take it as the first statement of any transaction that
 * checks a limit, before locking rows, so every such transaction acquires locks in the same order.
 */
export function lockWorkspaceLimits(tx: Db | Tx, workspaceId: string): Promise<void> {
  return advisoryXactLock(tx, LOCK_NS.workspaceLimits, workspaceId)
}
