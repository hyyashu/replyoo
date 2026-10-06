import type { Db, Tx } from '@replyooo/db'
import { connectedAccounts, type contacts, decryptToken, flowRuns } from '@replyooo/db'
import type { ContactState, Effect, FlowRunState, RunStatus, Wait } from '@replyooo/engine'
import type { AccountCredentials } from '@replyooo/meta'
import { and, eq, inArray, sql } from 'drizzle-orm'

export type FlowRunRow = typeof flowRuns.$inferSelect
export type ContactRow = typeof contacts.$inferSelect
export type AccountRow = typeof connectedAccounts.$inferSelect

const FINAL: ReadonlySet<RunStatus> = new Set(['completed', 'failed', 'expired', 'cancelled'])

export function toRunState(row: FlowRunRow): FlowRunState {
  return {
    status: row.status,
    currentStepId: row.currentStepId,
    wait: row.wait as Wait | null,
    waitUntil: row.waitUntil,
    vars: row.vars,
    stateVersion: row.stateVersion,
    outbound: row.outbound,
    commentId: row.commentId,
    error: row.error,
  }
}

export function runColumns(state: FlowRunState, now: Date) {
  return {
    status: state.status,
    currentStepId: state.currentStepId,
    wait: state.wait as Record<string, unknown> | null,
    waitUntil: state.waitUntil,
    vars: state.vars,
    stateVersion: state.stateVersion,
    outbound: state.outbound,
    commentId: state.commentId,
    error: state.error,
    completedAt: FINAL.has(state.status) ? now : null,
  } satisfies Partial<typeof flowRuns.$inferInsert>
}

export function toContactState(row: ContactRow): ContactState {
  return {
    username: row.username,
    name: row.name,
    email: row.email,
    phone: row.phone,
    tags: row.tags,
    fields: row.fields,
  }
}

/** Folds the engine's `update_contact` effects into new column values (same order as the engine). */
export function applyContactEffects(
  contact: ContactRow,
  effects: readonly Effect[],
): Pick<ContactRow, 'email' | 'phone' | 'tags' | 'fields'> | null {
  let { email, phone, tags, fields } = contact
  let changed = false
  for (const effect of effects) {
    if (effect.type !== 'update_contact') continue
    changed = true
    const { patch } = effect
    if (patch.email !== undefined) email = patch.email
    if (patch.phone !== undefined) phone = patch.phone
    if (patch.fields) fields = { ...fields, ...patch.fields }
    if (patch.removeTags) {
      const remove = patch.removeTags
      tags = tags.filter((tag) => !remove.includes(tag))
    }
    if (patch.addTags) tags = [...new Set([...tags, ...patch.addTags])]
  }
  return changed ? { email, phone, tags, fields } : null
}

export function credentials(account: AccountRow, key: Buffer): AccountCredentials {
  return { externalId: account.externalId, accessToken: decryptToken(account.accessTokenEnc, key) }
}

/** Ends a live run from outside the engine (send failures, reauth). Bumps the version so pending jobs no-op. */
export async function endRun(
  db: Db | Tx,
  runId: string,
  status: 'failed' | 'expired',
  error: string,
  now: Date,
): Promise<void> {
  await db
    .update(flowRuns)
    .set({
      status,
      error,
      wait: null,
      waitUntil: null,
      completedAt: now,
      stateVersion: sql`${flowRuns.stateVersion} + 1`,
    })
    .where(and(eq(flowRuns.id, runId), inArray(flowRuns.status, ['running', 'waiting'])))
}

/** Flags an active account. Returns false when it was already flagged or isn't active, so callers alert once. */
export async function markReauthRequired(db: Db | Tx, accountId: string): Promise<boolean> {
  const rows = await db
    .update(connectedAccounts)
    .set({ status: 'reauth_required' })
    .where(and(eq(connectedAccounts.id, accountId), eq(connectedAccounts.status, 'active')))
    .returning({ id: connectedAccounts.id })
  return rows.length > 0
}
