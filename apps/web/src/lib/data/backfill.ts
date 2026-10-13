import 'server-only'
import {
  automations,
  automationVersions,
  BACKFILL_MAX_COMMENTS,
  BACKFILL_WINDOWS_HOURS,
  type BackfillRun,
  connectedAccounts,
  createBackfillRun,
  handledCommentIds,
  latestBackfillRun,
} from '@replyooo/db'
import { classifyComments, type TriggerCandidate } from '@replyooo/engine'
import { gatherComments, MetaError } from '@replyooo/meta'
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { adapterFor, credentialsFor } from '../meta'
import { isUuid } from './ids'

export type RerunErrorCode =
  | 'not_found'
  | 'bad_window'
  | 'not_comment_automation'
  | 'not_active'
  | 'no_post_yet'
  | 'account_inactive'
  | 'reauth'
  | 'meta'

export interface RerunPreview {
  found: number
  handled: number
  noMatch: number
  eligible: number
  capped: boolean
}

export interface RerunRun {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed'
  windowHours: number
  found: number
  skippedHandled: number
  skippedNoMatch: number
  enqueued: number
  capped: boolean
  error: string | null
  createdAt: string
  finishedAt: string | null
}

export type RerunResult<T> = ({ ok: true } & T) | { ok: false; code: RerunErrorCode; message: string }

const fail = (code: RerunErrorCode, message: string): { ok: false; code: RerunErrorCode; message: string } => ({ ok: false, code, message })

function toRun(row: BackfillRun): RerunRun {
  return {
    id: row.id,
    status: row.status,
    windowHours: row.windowHours,
    found: row.found,
    skippedHandled: row.skippedHandled,
    skippedNoMatch: row.skippedNoMatch,
    enqueued: row.enqueued,
    capped: row.capped,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  }
}

function validWindow(hours: number): boolean {
  return (BACKFILL_WINDOWS_HOURS as readonly number[]).includes(hours)
}

/** The automation and account a re-run would use, or why it cannot run. */
async function loadTarget(workspaceId: string, automationId: string) {
  if (!isUuid(automationId)) return fail('not_found', 'Automation not found')
  const [row] = await db()
    .select({
      automation: automations,
      account: connectedAccounts,
      definition: automationVersions.definition,
      publishedAt: automationVersions.publishedAt,
    })
    .from(automations)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, automations.connectedAccountId))
    .leftJoin(automationVersions, eq(automationVersions.id, automations.currentVersionId))
    .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, automationId)))
  if (!row) return fail('not_found', 'Automation not found')
  if (!row.definition || !row.publishedAt || row.automation.status !== 'active') return fail('not_active', 'Publish and turn on the automation first')
  const trigger = row.definition.trigger
  if (trigger.type !== 'comment_keyword') return fail('not_comment_automation', 'Only comment automations can be re-run')
  if (trigger.posts.mode === 'next' && !row.automation.pinnedMediaId) {
    return fail('no_post_yet', 'This automation has not picked its post yet')
  }
  if (row.account.status !== 'active') return fail('account_inactive', 'Reconnect this account first')
  return { ok: true as const, automation: row.automation, account: row.account, trigger, publishedAt: row.publishedAt }
}

export async function previewRerun(workspaceId: string, automationId: string, windowHours: number): Promise<RerunResult<{ preview: RerunPreview }>> {
  if (!validWindow(windowHours)) return fail('bad_window', 'Pick one of the offered time ranges')
  const target = await loadTarget(workspaceId, automationId)
  if (!target.ok) return target
  const now = new Date()
  try {
    const gathered = await gatherComments(adapterFor(target.account.platform), credentialsFor(target.account), {
      trigger: target.trigger,
      pinnedMediaId: target.automation.pinnedMediaId,
      since: new Date(now.getTime() - windowHours * 3_600_000),
      max: BACKFILL_MAX_COMMENTS,
    })
    const others = gathered.comments.filter((c) => c.authorId !== target.account.externalId)
    const handled = await handledCommentIds(db(), target.account.id, others.map((c) => c.id))
    const candidate: TriggerCandidate = {
      automationId: target.automation.id,
      publishedAt: target.publishedAt,
      trigger: target.trigger,
      pinnedMediaId: target.automation.pinnedMediaId,
    }
    const buckets = classifyComments(others, candidate, handled, now)
    return {
      ok: true,
      preview: {
        found: others.length,
        handled: buckets.handled.length,
        noMatch: buckets.no_match.length + buckets.too_old.length,
        eligible: buckets.eligible.length,
        capped: gathered.capped,
      },
    }
  } catch (error) {
    if (!(error instanceof MetaError)) throw error
    if (error.kind === 'reauth') return fail('reauth', `Meta revoked access to @${target.account.username}. Reconnect it in Settings.`)
    return fail('meta', error.message)
  }
}

export async function startRerun(workspaceId: string, automationId: string, windowHours: number): Promise<RerunResult<{ run: RerunRun }>> {
  if (!validWindow(windowHours)) return fail('bad_window', 'Pick one of the offered time ranges')
  const target = await loadTarget(workspaceId, automationId)
  if (!target.ok) return target
  const { run } = await createBackfillRun(db(), {
    automationId: target.automation.id,
    connectedAccountId: target.account.id,
    windowHours,
  })
  return { ok: true, run: toRun(run) }
}

export async function latestRerun(workspaceId: string, automationId: string): Promise<RerunRun | null> {
  if (!isUuid(automationId)) return null
  const [owned] = await db()
    .select({ id: automations.id })
    .from(automations)
    .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, automationId)))
  if (!owned) return null
  const row = await latestBackfillRun(db(), automationId)
  return row ? toRun(row) : null
}
