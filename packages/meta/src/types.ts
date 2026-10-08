import type { Platform } from '@replyooo/shared'

export interface AccountCredentials {
  /** Instagram professional account ID or Facebook Page ID (webhook `entry.id`). */
  externalId: string
  accessToken: string
}

export type SendableButton =
  | { type: 'url'; label: string; url: string }
  | { type: 'postback'; label: string; payload: string }

/** Exactly one Graph send call. */
export type SendableMessage =
  | { kind: 'text'; text: string; buttons?: SendableButton[] }
  | { kind: 'image'; url: string }

export interface SendResult {
  messageId: string | null
}

export interface Profile {
  name: string | null
  username: string | null
  avatarUrl: string | null
  /** Instagram only: whether the person follows the account / the account follows them. */
  followsYou?: boolean | null
  youFollow?: boolean | null
}

/** A published post or reel, as shown in the dashboard's post picker. `id` matches the webhook's `mediaId`. */
export interface MediaItem {
  id: string
  caption: string | null
  thumbnailUrl: string | null
  permalink: string | null
  publishedAt: Date | null
}

export interface TokenResult {
  accessToken: string
  expiresAt: Date | null
}

export interface IceBreaker {
  question: string
  payload: string
}

interface EventBase {
  platform: Platform
  /** The connected account the webhook was delivered for (`entry.id`). */
  accountExternalId: string
  /** Unique per logical event; stored as `webhook_events.dedup_key`. */
  dedupKey: string
  /** ISO timestamp, so the event stays JSON-safe in `webhook_events.payload`. */
  occurredAt: string
  /** IGSID / PSID of the person. */
  senderId: string
}

export type NormalizedEvent =
  | (EventBase & { type: 'dm_received'; messageId: string; text: string | null })
  | (EventBase & { type: 'story_reply'; messageId: string; storyId: string | null; text: string | null; isReaction: boolean })
  | (EventBase & { type: 'postback'; messageId: string | null; payload: string; title: string | null })
  | (EventBase & {
      type: 'comment_created'
      commentId: string
      mediaId: string
      text: string
      senderUsername: string | null
      senderName: string | null
    })

export type NormalizedEventType = NormalizedEvent['type']

export interface PlatformAdapter {
  readonly platform: Platform
  normalizeWebhook(payload: unknown): NormalizedEvent[]
  sendMessage(account: AccountCredentials, recipientId: string, message: SendableMessage): Promise<SendResult>
  sendPrivateReply(account: AccountCredentials, commentId: string, message: SendableMessage): Promise<SendResult>
  replyToComment(account: AccountCredentials, commentId: string, text: string): Promise<SendResult>
  getProfile(account: AccountCredentials, userId: string): Promise<Profile>
  getMediaPublishedAt(account: AccountCredentials, mediaId: string): Promise<Date | null>
  /** The account's most recent posts, newest first. */
  listMedia(account: AccountCredentials, limit?: number): Promise<MediaItem[]>
  /** The account's live stories (they expire after 24h), newest first. Instagram only. */
  listStories?(account: AccountCredentials, limit?: number): Promise<MediaItem[]>
  /** React to a message the person sent us with a ❤️. Instagram only. */
  reactToMessage?(account: AccountCredentials, recipientId: string, messageId: string): Promise<void>
  /** Instagram only. */
  isFollower?(account: AccountCredentials, userId: string): Promise<boolean>
  setIceBreakers(account: AccountCredentials, items: IceBreaker[]): Promise<void>
  subscribeWebhooks(account: AccountCredentials): Promise<void>
  refreshToken(account: AccountCredentials): Promise<TokenResult>
}
