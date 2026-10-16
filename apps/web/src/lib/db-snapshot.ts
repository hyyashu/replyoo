import 'server-only'
import type { Db, Tx } from '@replyooo/db'
import { sql } from 'drizzle-orm'

export interface ReadSnapshot {
  /** Reads through this see one consistent view of the database. */
  tx: Tx
  /** Ends the snapshot: commits, or rolls back when given an error. Safe to call more than once. */
  end: (error?: unknown) => Promise<void>
  /** Settles once the transaction is over, however it ended. */
  closed: Promise<void>
}

/**
 * Opens a read-only repeatable-read transaction and holds it until end() is called, so a long
 * paginated read (like a CSV export) never sees rows move between pages. Postgres drops it if it
 * sits idle or a query runs too long.
 */
export async function openReadSnapshot(database: Db): Promise<ReadSnapshot> {
  let release!: (error?: unknown) => void
  const gate = new Promise<void>((resolve, reject) => {
    release = (error) => (error === undefined ? resolve() : reject(error))
  })
  let opened!: (tx: Tx) => void
  const finished: Promise<void> = database.transaction(
    async (tx) => {
      await tx.execute(sql`set local idle_in_transaction_session_timeout = '60s'`)
      await tx.execute(sql`set local statement_timeout = '30s'`)
      opened(tx)
      await gate
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
  const ready = new Promise<Tx>((resolve, reject) => {
    opened = resolve
    finished.catch(reject)
  })
  const closed = finished.then(
    () => undefined,
    () => undefined,
  )
  const tx = await ready
  let ended = false
  const end = (error?: unknown) => {
    if (!ended) {
      ended = true
      release(error ?? undefined)
    }
    return closed
  }
  return { tx, end, closed }
}
