import type { Db } from '@replyooo/db'
import { connectedAccounts, contacts, createTrackedLinks, flowRuns, messages, usageCounters } from '@replyooo/db'
import type { AccountCredentials, PlatformAdapter, SendableButton, SendableMessage, SendResult } from '@replyooo/meta'
import { MetaError } from '@replyooo/meta'
import { encodePostback } from '@replyooo/shared'
import { and, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm'
import { flagReauth } from './alerts'
import { scheduleClickFollowUp } from './click-follow-ups'
import type { Deps, OutboundJobData } from './deps'
import type { OutboundBody } from './flow'
import type { ContactRow } from './records'
import { credentials, endRun } from './records'

export const DM_WINDOW_MS = 24 * 60 * 60 * 1000
/** How long a claim protects a message from other senders. Far above one Graph call (15s timeout). */
export const SEND_LEASE_MS = 10 * 60 * 1000
/** Claims per message across all jobs and sweeps; the last one fails the message whatever the error. */
export const MAX_SEND_ATTEMPTS = 5

export type OutboundResult = { status: 'done' } | { status: 'rate_limited'; retryInMs: number }

type MessageRow = typeof messages.$inferSelect

/** A message another sender may take: queued, or claimed so long ago that the claim has lapsed. */
export function claimable(now: Date) {
  return or(
    eq(messages.status, 'queued'),
    and(eq(messages.status, 'sending'), lt(messages.claimedAt, new Date(now.getTime() - SEND_LEASE_MS))),
  )!
}

/**
 * Sends each message at most once per lease: a message is claimed (`sending`) right before its Graph call and only
 * a lapsed claim can be taken again. A crash or DB error after Meta accepted therefore leaves the message claimed,
 * and the retry skips it instead of sending it twice.
 */
export async function handleOutbound(
  deps: Deps,
  job: OutboundJobData,
  attempt: { isFinal: boolean } = { isFinal: false },
): Promise<OutboundResult> {
  const { db } = deps
  for (const [index, id] of job.messageIds.entries()) {
    const [row] = await db
      .select({ message: messages, contact: contacts, account: connectedAccounts })
      .from(messages)
      .innerJoin(contacts, eq(messages.contactId, contacts.id))
      .innerJoin(connectedAccounts, eq(messages.connectedAccountId, connectedAccounts.id))
      .where(eq(messages.id, id))
    if (!row) continue
    const { contact, account } = row
    const now = deps.now()
    if (row.message.status !== 'queued' && row.message.status !== 'sending') continue
    // Someone else holds this message; later ones must wait for it to keep the order.
    if (row.message.status === 'sending' && !leaseLapsed(row.message.claimedAt, now)) return { status: 'done' }

    const stop = async (reason: string, runStatus: 'failed' | 'expired'): Promise<OutboundResult> => {
      await failMessages(db, [id], reason, ['queued', 'sending'])
      await failMessages(db, job.messageIds.slice(index + 1), 'skipped')
      if (row.message.flowRunId) await endRun(db, row.message.flowRunId, runStatus, reason, now)
      return { status: 'done' }
    }

    if (account.status !== 'active') return stop('account_inactive', 'failed')
    if (row.message.kind === 'dm' && !withinWindow(contact.lastInboundAt, now)) return stop('window_closed', 'expired')

    const waitMs = await deps.rateLimiter.take(account.id)
    if (waitMs > 0) return { status: 'rate_limited', retryInMs: waitMs }

    const [message] = await db
      .update(messages)
      .set({ status: 'sending', claimedAt: now, attempts: sql`${messages.attempts} + 1` })
      .where(and(eq(messages.id, id), claimable(now)))
      .returning()
    if (!message) return { status: 'done' }

    let result: SendResult
    try {
      result = await send(deps.adapters[account.platform], credentials(account, deps.tokenKey), contact, await withTrackedLinks(deps, message))
    } catch (error) {
      const meta = error instanceof MetaError ? error : null
      const last = attempt.isFinal || message.attempts >= MAX_SEND_ATTEMPTS
      if (!last && (!meta || meta.kind === 'retryable')) {
        // Nothing went out (or we cannot tell, e.g. a timeout); hand the message back for the job's retry.
        await release(db, id)
        throw error
      }
      if (meta?.kind === 'reauth') await flagReauth(deps, account.id)
      const reason = meta ? (meta.details.reason ?? meta.kind) : 'send_error'
      deps.log.warn(
        { messageId: id, kind: message.kind, reason, err: meta ? undefined : error, metaMessage: meta?.message, ...meta?.details },
        'outbound message failed',
      )
      return stop(reason, reason === 'window_closed' ? 'expired' : 'failed')
    }

    // Meta accepted the message. From here on a failure must not resend it: the claim stays until marked sent.
    await db
      .update(messages)
      .set({ status: 'sent', externalId: result.messageId, sentAt: now, error: null, claimedAt: null })
      .where(and(eq(messages.id, id), eq(messages.status, 'sending')))
    await countUsage(db, account.workspaceId, contact.id, now)
    // The DM is out; a lost follow-up must not make the job retry it.
    await scheduleClickFollowUp(db, message, now).catch((error: unknown) =>
      deps.log.warn({ messageId: id, err: error }, 'could not schedule the click follow-up'),
    )
  }
  return { status: 'done' }
}

function leaseLapsed(claimedAt: Date | null, now: Date): boolean {
  return claimedAt === null || now.getTime() - claimedAt.getTime() > SEND_LEASE_MS
}

async function release(db: Db, id: string): Promise<void> {
  await db
    .update(messages)
    .set({ status: 'queued', claimedAt: null })
    .where(and(eq(messages.id, id), eq(messages.status, 'sending')))
}

function withinWindow(lastInboundAt: Date | null, now: Date): boolean {
  return lastInboundAt !== null && now.getTime() - lastInboundAt.getTime() <= DM_WINDOW_MS
}

/**
 * Swaps each url button of a DM for a short tracked link (`${APP_URL}/l/<code>`). A retried message finds its
 * existing links, so codes stay stable. Tracking must never stop a DM: on any error the original message is sent.
 */
export async function withTrackedLinks(
  deps: Deps,
  message: MessageRow,
  create: typeof createTrackedLinks = createTrackedLinks,
): Promise<MessageRow> {
  if ((message.kind !== 'dm' && message.kind !== 'private_reply') || !message.flowRunId) return message
  const body = message.body as unknown as OutboundBody
  if (body.type !== 'message') return message
  const buttons = body.message.buttons ?? []
  const cards = body.message.cards ?? []
  const links = [
    ...buttons.flatMap((button, position) => (button.type === 'url' ? [{ position, url: button.url }] : [])),
    // A message carries buttons or cards, never both, so card positions cannot clash with button positions.
    ...cards.map((card, position) => ({ position, url: card.button.url })),
  ]
  if (links.length === 0) return message
  try {
    const [run] = await deps.db.select({ automationId: flowRuns.automationId }).from(flowRuns).where(eq(flowRuns.id, message.flowRunId))
    if (!run) return message
    const codes = await create(deps.db, { messageId: message.id, contactId: message.contactId, automationId: run.automationId, links })
    const origin = deps.appUrl.replace(/\/+$/, '')
    const tracked = buttons.map((button, position) => {
      const code = codes.get(position)
      return button.type === 'url' && code ? { ...button, url: `${origin}/l/${code}` } : button
    })
    const trackedCards = cards.map((card, position) => {
      const code = codes.get(position)
      return code ? { ...card, button: { ...card.button, url: `${origin}/l/${code}` } } : card
    })
    const trackedBody: OutboundBody = {
      type: 'message',
      message: {
        ...body.message,
        ...(buttons.length > 0 ? { buttons: tracked } : {}),
        ...(cards.length > 0 ? { cards: trackedCards } : {}),
      },
    }
    return { ...message, body: trackedBody as unknown as Record<string, unknown> }
  } catch (error) {
    deps.log.warn({ messageId: message.id, err: error }, 'link tracking failed; sending the original links')
    return message
  }
}

/** Only queued messages by default: a `sending` one belongs to whoever claimed it. */
export async function failMessages(
  db: Db,
  ids: string[],
  error: string,
  from: ('queued' | 'sending')[] = ['queued'],
): Promise<void> {
  if (ids.length === 0) return
  await db
    .update(messages)
    .set({ status: 'failed', error, claimedAt: null })
    .where(and(inArray(messages.id, ids), inArray(messages.status, from)))
}

export function toSendable(body: OutboundBody, runId: string | null): SendableMessage {
  if (body.type === 'image') return { kind: 'image', url: body.url }
  if (body.type === 'comment') return { kind: 'text', text: body.text }
  if (body.message.cards && body.message.cards.length > 0) return { kind: 'carousel', cards: body.message.cards }
  const buttons = (body.message.buttons ?? []).flatMap<SendableButton>((button) => {
    if (button.type === 'url') return [{ type: 'url', label: button.label, url: button.url }]
    if (!runId) return []
    const payload = encodePostback({ kind: 'run', runId, stepId: button.stepId, buttonId: button.buttonId })
    return [{ type: 'postback', label: button.label, payload }]
  })
  return buttons.length > 0 ? { kind: 'text', text: body.message.text, buttons } : { kind: 'text', text: body.message.text }
}

async function send(
  adapter: PlatformAdapter,
  account: AccountCredentials,
  contact: ContactRow,
  message: MessageRow,
): Promise<SendResult> {
  const body = message.body as unknown as OutboundBody
  switch (message.kind) {
    case 'dm':
      return adapter.sendMessage(account, contact.platformUserId, toSendable(body, message.flowRunId))
    case 'private_reply':
      return adapter.sendPrivateReply(account, requireCommentId(message), toSendable(body, message.flowRunId))
    case 'comment_reply':
      return adapter.replyToComment(account, requireCommentId(message), body.type === 'comment' ? body.text : '')
    default:
      throw new Error(`Cannot send a message of kind ${message.kind}`)
  }
}

function requireCommentId(message: MessageRow): string {
  if (!message.commentId) throw new Error(`Message ${message.id} has no comment id`)
  return message.commentId
}

/** Counts a contact once per UTC month, on its first successful outbound message. */
export async function countUsage(db: Db, workspaceId: string, contactId: string, now: Date): Promise<void> {
  const period = now.toISOString().slice(0, 7)
  await db.transaction(async (tx) => {
    const claimed = await tx
      .update(contacts)
      .set({ lastCountedPeriod: period })
      .where(and(eq(contacts.id, contactId), or(isNull(contacts.lastCountedPeriod), ne(contacts.lastCountedPeriod, period))))
      .returning({ id: contacts.id })
    if (claimed.length === 0) return
    await tx
      .insert(usageCounters)
      .values({ workspaceId, period, contactsReached: 1 })
      .onConflictDoUpdate({
        target: [usageCounters.workspaceId, usageCounters.period],
        set: { contactsReached: sql`${usageCounters.contactsReached} + 1`, updatedAt: now },
      })
  })
}
