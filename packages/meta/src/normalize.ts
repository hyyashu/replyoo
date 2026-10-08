import type { Platform } from '@replyooo/shared'
import { z } from 'zod'
import type { NormalizedEvent } from './types'

const Ref = z.looseObject({ id: z.string() })

const MessagingSchema = z.looseObject({
  sender: Ref,
  recipient: Ref,
  timestamp: z.number(),
  message: z
    .looseObject({
      mid: z.string(),
      text: z.string().optional(),
      is_echo: z.boolean().optional(),
      is_deleted: z.boolean().optional(),
      quick_reply: z.looseObject({ payload: z.string() }).optional(),
      reply_to: z.looseObject({ story: z.looseObject({}).optional() }).optional(),
    })
    .optional(),
  postback: z
    .looseObject({ mid: z.string().optional(), title: z.string().optional(), payload: z.string() })
    .optional(),
})

const EntrySchema = z.looseObject({
  id: z.string(),
  time: z.number().optional(),
  messaging: z.array(z.unknown()).optional(),
  changes: z.array(z.looseObject({ field: z.string(), value: z.unknown() })).optional(),
})

const PayloadSchema = z.looseObject({ object: z.string(), entry: z.array(z.unknown()) })

const InstagramCommentSchema = z.looseObject({
  id: z.string(),
  text: z.string().default(''),
  from: z.looseObject({ id: z.string(), username: z.string().optional() }),
  media: Ref,
})

const FacebookFeedSchema = z.looseObject({
  item: z.string(),
  verb: z.string(),
  comment_id: z.string().optional(),
  post_id: z.string().optional(),
  message: z.string().optional(),
  from: z.looseObject({ id: z.string(), name: z.string().optional() }).optional(),
  created_time: z.number().optional(),
})

type Entry = z.infer<typeof EntrySchema>
type ChangeHandler = (entry: Entry, field: string, value: unknown) => NormalizedEvent | null

/** Meta sends seconds for `changes` and milliseconds for `messaging`. */
function toIso(time: number | undefined): string {
  if (time === undefined) return new Date().toISOString()
  const date = new Date(time < 1e12 ? time * 1000 : time)
  // An out-of-range timestamp makes toISOString() throw, which would drop the whole batch; use now instead.
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

const hasWordCharacters = (text: string) => /[\p{L}\p{N}]/u.test(text)

function normalize(
  platform: Platform,
  expectedObject: string,
  payload: unknown,
  onChange: ChangeHandler,
): NormalizedEvent[] {
  const parsed = PayloadSchema.safeParse(payload)
  if (!parsed.success || parsed.data.object !== expectedObject) return []
  const events: NormalizedEvent[] = []
  for (const rawEntry of parsed.data.entry) {
    // One malformed entry must not drop the valid ones in the same batch.
    const parsedEntry = EntrySchema.safeParse(rawEntry)
    if (!parsedEntry.success) continue
    const entry = parsedEntry.data
    for (const item of entry.messaging ?? []) {
      const event = messagingEvent(platform, entry.id, item)
      if (event) events.push(event)
    }
    for (const change of entry.changes ?? []) {
      const event = onChange(entry, change.field, change.value)
      if (event) events.push(event)
    }
  }
  return events
}

function messagingEvent(platform: Platform, accountExternalId: string, raw: unknown): NormalizedEvent | null {
  const parsed = MessagingSchema.safeParse(raw)
  if (!parsed.success) return null
  const item = parsed.data
  const senderId = item.sender.id
  if (senderId === accountExternalId) return null
  const base = { platform, accountExternalId, senderId, occurredAt: toIso(item.timestamp) }

  if (item.postback) {
    const mid = item.postback.mid ?? null
    return {
      ...base,
      type: 'postback',
      dedupKey: `${platform}:postback:${mid ?? `${senderId}:${item.timestamp}`}`,
      messageId: mid,
      payload: item.postback.payload,
      title: item.postback.title ?? null,
    }
  }

  const message = item.message
  if (!message || message.is_echo || message.is_deleted) return null
  const dedupKey = `${platform}:message:${message.mid}`

  if (message.quick_reply) {
    return {
      ...base,
      type: 'postback',
      dedupKey,
      messageId: message.mid,
      payload: message.quick_reply.payload,
      title: message.text ?? null,
    }
  }

  const text = message.text && message.text.trim().length > 0 ? message.text : null
  if (message.reply_to?.story) {
    return {
      ...base,
      type: 'story_reply',
      dedupKey,
      messageId: message.mid,
      text,
      isReaction: text !== null && !hasWordCharacters(text),
    }
  }
  return { ...base, type: 'dm_received', dedupKey, messageId: message.mid, text }
}

const instagramComment: ChangeHandler = (entry, field, value) => {
  if (field !== 'comments') return null
  const parsed = InstagramCommentSchema.safeParse(value)
  if (!parsed.success) return null
  const comment = parsed.data
  if (comment.from.id === entry.id) return null
  return {
    platform: 'instagram',
    type: 'comment_created',
    accountExternalId: entry.id,
    senderId: comment.from.id,
    senderUsername: comment.from.username ?? null,
    senderName: null,
    dedupKey: `instagram:comment:${comment.id}`,
    occurredAt: toIso(entry.time),
    commentId: comment.id,
    mediaId: comment.media.id,
    text: comment.text,
  }
}

const facebookComment: ChangeHandler = (entry, field, value) => {
  if (field !== 'feed') return null
  const parsed = FacebookFeedSchema.safeParse(value)
  if (!parsed.success) return null
  const feed = parsed.data
  if (feed.item !== 'comment' || feed.verb !== 'add') return null
  if (!feed.comment_id || !feed.post_id || !feed.from || feed.from.id === entry.id) return null
  return {
    platform: 'facebook',
    type: 'comment_created',
    accountExternalId: entry.id,
    senderId: feed.from.id,
    senderUsername: null,
    senderName: feed.from.name ?? null,
    dedupKey: `facebook:comment:${feed.comment_id}`,
    occurredAt: toIso(feed.created_time ?? entry.time),
    commentId: feed.comment_id,
    mediaId: feed.post_id,
    text: feed.message ?? '',
  }
}

export function normalizeInstagramWebhook(payload: unknown): NormalizedEvent[] {
  return normalize('instagram', 'instagram', payload, instagramComment)
}

export function normalizeFacebookWebhook(payload: unknown): NormalizedEvent[] {
  return normalize('facebook', 'page', payload, facebookComment)
}
