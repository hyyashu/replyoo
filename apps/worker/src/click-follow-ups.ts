import type { Db } from '@replyooo/db'
import { automations, clickFollowUps, connectedAccounts, contacts, flowRuns, linkClicks, messages, trackedLinks } from '@replyooo/db'
import { and, asc, eq, lte } from 'drizzle-orm'
import type { Deps } from './deps'
import type { OutboundBody } from './flow'
import { inSendOrder } from './flow'
import { DM_WINDOW_MS } from './outbound'

type MessageRow = typeof messages.$inferSelect

const BATCH = 100

/**
 * Called once a message is sent. A message whose body carries a `followUp` gets one follow-up row; the unique
 * message id makes a retried send a no-op.
 */
export async function scheduleClickFollowUp(db: Db, message: MessageRow, now: Date): Promise<void> {
  const body = message.body as unknown as OutboundBody
  if (body.type !== 'message' || !body.message.followUp) return
  const { afterMinutes, text } = body.message.followUp
  let automationId: string | null = null
  if (message.flowRunId) {
    const [run] = await db.select({ automationId: flowRuns.automationId }).from(flowRuns).where(eq(flowRuns.id, message.flowRunId))
    automationId = run?.automationId ?? null
  }
  await db
    .insert(clickFollowUps)
    .values({
      messageId: message.id,
      contactId: message.contactId,
      connectedAccountId: message.connectedAccountId,
      automationId,
      flowRunId: message.flowRunId,
      text,
      dueAt: new Date(now.getTime() + afterMinutes * 60_000),
    })
    .onConflictDoNothing()
}

/**
 * Sends (or skips) every follow-up that is due. Each row is claimed under a row lock, so two sweeps never send
 * the same follow-up twice. Returns how many were sent.
 */
export async function sendDueClickFollowUps(deps: Deps): Promise<number> {
  const { db } = deps
  const now = deps.now()
  const due = await db
    .select({ id: clickFollowUps.id })
    .from(clickFollowUps)
    .where(and(eq(clickFollowUps.status, 'pending'), lte(clickFollowUps.dueAt, now)))
    .orderBy(asc(clickFollowUps.dueAt), asc(clickFollowUps.id))
    .limit(BATCH)
  let sent = 0
  for (const { id } of due) {
    const messageIds = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(clickFollowUps)
        .where(and(eq(clickFollowUps.id, id), eq(clickFollowUps.status, 'pending')))
        .for('update', { skipLocked: true })
      if (!row) return null

      const finish = async (status: 'sent' | 'skipped', reason: string | null, followUpMessageId: string | null = null) => {
        await tx.update(clickFollowUps).set({ status, reason, followUpMessageId, finishedAt: now }).where(eq(clickFollowUps.id, id))
        return null
      }

      const [click] = await tx
        .select({ id: linkClicks.id })
        .from(linkClicks)
        .innerJoin(trackedLinks, eq(trackedLinks.id, linkClicks.linkId))
        .where(eq(trackedLinks.messageId, row.messageId))
        .limit(1)
      if (click) return finish('skipped', 'clicked')

      const [account] = await tx.select({ status: connectedAccounts.status }).from(connectedAccounts).where(eq(connectedAccounts.id, row.connectedAccountId))
      if (account?.status !== 'active') return finish('skipped', 'account_inactive')

      const [automation] = row.automationId
        ? await tx.select({ status: automations.status }).from(automations).where(eq(automations.id, row.automationId))
        : []
      if (automation?.status !== 'active') return finish('skipped', 'automation_inactive')

      const [contact] = await tx.select({ lastInboundAt: contacts.lastInboundAt }).from(contacts).where(eq(contacts.id, row.contactId))
      const lastInbound = contact?.lastInboundAt
      if (!lastInbound || now.getTime() - lastInbound.getTime() > DM_WINDOW_MS) return finish('skipped', 'window_closed')

      // A reminder must never land in the middle of another conversation.
      const [waiting] = await tx
        .select({ id: flowRuns.id })
        .from(flowRuns)
        .where(and(eq(flowRuns.contactId, row.contactId), eq(flowRuns.status, 'waiting')))
        .limit(1)
      if (waiting) return finish('skipped', 'in_conversation')

      const [original] = await tx.select({ body: messages.body }).from(messages).where(eq(messages.id, row.messageId))
      const bodies = original ? followUpBodies(original.body as unknown as OutboundBody, row.text) : []
      if (bodies.length === 0) return finish('skipped', 'no_links')

      const ids: string[] = []
      for (const [index, body] of bodies.entries()) {
        const [inserted] = await tx
          .insert(messages)
          .values({
            contactId: row.contactId,
            connectedAccountId: row.connectedAccountId,
            flowRunId: row.flowRunId,
            direction: 'out',
            kind: 'dm',
            body: body as unknown as Record<string, unknown>,
            status: 'queued',
            createdAt: inSendOrder(index),
          })
          .returning({ id: messages.id })
        ids.push(inserted!.id)
      }
      await finish('sent', null, ids[ids.length - 1]!)
      return ids
    })
    if (messageIds) {
      // A lost enqueue is picked up by the sweep's stuck-message pass.
      await deps.jobs.outbound({ messageIds })
      sent++
    }
  }
  return sent
}

/**
 * The follow-up repeats the original's links, untracked as stored (sending tracks them afresh): the text with the
 * same link buttons, or the text and then the same carousel. Reply buttons are dropped; nothing waits on them.
 */
export function followUpBodies(original: OutboundBody, text: string): OutboundBody[] {
  if (original.type !== 'message') return []
  const cards = original.message.cards ?? []
  if (cards.length > 0) {
    return [
      { type: 'message', message: { text } },
      { type: 'message', message: { text: '', cards } },
    ]
  }
  const buttons = (original.message.buttons ?? []).filter((button) => button.type === 'url')
  if (buttons.length === 0) return []
  return [{ type: 'message', message: { text, buttons } }]
}
