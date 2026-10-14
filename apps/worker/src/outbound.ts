import type { Db } from '@replyooo/db'
import { connectedAccounts, contacts, createTrackedLinks, flowRuns, messages, usageCounters } from '@replyooo/db'
import type { AccountCredentials, PlatformAdapter, SendableButton, SendableMessage, SendResult } from '@replyooo/meta'
import { MetaError } from '@replyooo/meta'
import { encodePostback } from '@replyooo/shared'
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { flagReauth } from './alerts'
import type { Deps, OutboundJobData } from './deps'
import type { OutboundBody } from './flow'
import type { ContactRow } from './records'
import { credentials, endRun } from './records'

export const DM_WINDOW_MS = 24 * 60 * 60 * 1000

export type OutboundResult = { status: 'done' } | { status: 'rate_limited'; retryInMs: number }

type MessageRow = typeof messages.$inferSelect

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
    if (!row || row.message.status !== 'queued') continue
    const { message, contact, account } = row
    const now = deps.now()

    const stop = async (reason: string, runStatus: 'failed' | 'expired'): Promise<OutboundResult> => {
      await failMessages(db, [id], reason)
      await failMessages(db, job.messageIds.slice(index + 1), 'skipped')
      if (message.flowRunId) await endRun(db, message.flowRunId, runStatus, reason, now)
      return { status: 'done' }
    }

    if (account.status !== 'active') return stop('account_inactive', 'failed')
    if (message.kind === 'dm' && !withinWindow(contact.lastInboundAt, now)) return stop('window_closed', 'expired')

    const waitMs = await deps.rateLimiter.take(account.id)
    if (waitMs > 0) return { status: 'rate_limited', retryInMs: waitMs }

    try {
      const result = await send(deps.adapters[account.platform], credentials(account, deps.tokenKey), contact, await withTrackedLinks(deps, message))
      await db
        .update(messages)
        .set({ status: 'sent', externalId: result.messageId, sentAt: now, error: null })
        .where(and(eq(messages.id, id), eq(messages.status, 'queued')))
      await countUsage(db, account.workspaceId, contact.id, now)
    } catch (error) {
      if (!(error instanceof MetaError)) throw error
      if (error.kind === 'retryable' && !attempt.isFinal) throw error
      if (error.kind === 'reauth') await flagReauth(deps, account.id)
      const reason = error.details.reason ?? error.kind
      deps.log.warn(
        { messageId: id, kind: message.kind, reason, metaMessage: error.message, ...error.details },
        'outbound message failed',
      )
      return stop(reason, reason === 'window_closed' ? 'expired' : 'failed')
    }
  }
  return { status: 'done' }
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

async function failMessages(db: Db, ids: string[], error: string): Promise<void> {
  if (ids.length === 0) return
  await db
    .update(messages)
    .set({ status: 'failed', error })
    .where(and(inArray(messages.id, ids), eq(messages.status, 'queued')))
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
