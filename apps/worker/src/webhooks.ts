import { webhookEvents } from '@replyooo/db'
import type { Platform } from '@replyooo/shared'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Deps } from './deps'

export function verifySignature(rawBody: Buffer, header: string | undefined, secrets: readonly string[]): boolean {
  if (!header?.startsWith('sha256=')) return false
  const received = Buffer.from(header.slice('sha256='.length), 'hex')
  return secrets.some((secret) => {
    const expected = createHmac('sha256', secret).update(rawBody).digest()
    return expected.length === received.length && timingSafeEqual(expected, received)
  })
}

export function platformForObject(object: unknown): Platform | null {
  if (object === 'instagram') return 'instagram'
  if (object === 'page') return 'facebook'
  return null
}

export async function ingestWebhook(deps: Deps, body: unknown): Promise<{ stored: number; duplicates: number }> {
  const object = body !== null && typeof body === 'object' ? (body as { object?: unknown }).object : undefined
  const platform = platformForObject(object)
  if (!platform) return { stored: 0, duplicates: 0 }
  const events = deps.adapters[platform].normalizeWebhook(body)
  if (events.length === 0) return { stored: 0, duplicates: 0 }

  const rows = await deps.db
    .insert(webhookEvents)
    .values(events.map((event) => ({ platform, dedupKey: event.dedupKey, payload: event })))
    .onConflictDoNothing({ target: webhookEvents.dedupKey })
    .returning({ id: webhookEvents.id })
  for (const row of rows) await deps.jobs.inbound(row.id)
  return { stored: rows.length, duplicates: events.length - rows.length }
}
