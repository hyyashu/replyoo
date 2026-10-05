import type { Trigger, TriggerOf } from '@replyooo/shared'
import { matchesAnyKeyword } from '@replyooo/shared'

export interface TriggerCandidate {
  automationId: string
  publishedAt: Date
  trigger: Trigger
  /** For posts.mode === 'next': the media pinned on first match. */
  pinnedMediaId?: string | null
}

export type InboundForMatch =
  | { kind: 'comment'; text: string; mediaId: string; mediaPublishedAt: Date | null }
  | { kind: 'dm'; text: string }
  | { kind: 'story'; text: string | null; isReaction: boolean }

export function matchAutomation(
  event: InboundForMatch,
  candidates: readonly TriggerCandidate[],
): TriggerCandidate | null {
  const newestFirst = [...candidates].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
  const find = (predicate: (c: TriggerCandidate) => boolean) => newestFirst.find(predicate) ?? null

  const dmKeyword = (text: string) =>
    find((c) => c.trigger.type === 'dm_keyword' && matchesAnyKeyword(text, c.trigger.keywords, c.trigger.match))
  const anyDm = () => find((c) => c.trigger.type === 'any_dm')

  switch (event.kind) {
    case 'comment':
      return find(
        (c) =>
          c.trigger.type === 'comment_keyword' &&
          postMatches(c, c.trigger, event) &&
          matchesAnyKeyword(event.text, c.trigger.keywords, c.trigger.match),
      )
    case 'dm':
      return dmKeyword(event.text) ?? anyDm()
    case 'story': {
      const story = find((c) => c.trigger.type === 'story_reply' && storyMatches(c.trigger, event))
      if (story) return story
      if (event.isReaction || event.text === null) return null
      return dmKeyword(event.text) ?? anyDm()
    }
  }
}

function postMatches(
  candidate: TriggerCandidate,
  trigger: TriggerOf<'comment_keyword'>,
  event: Extract<InboundForMatch, { kind: 'comment' }>,
): boolean {
  switch (trigger.posts.mode) {
    case 'any':
      return true
    case 'specific':
      return trigger.posts.mediaIds.includes(event.mediaId)
    case 'next':
      if (candidate.pinnedMediaId) return candidate.pinnedMediaId === event.mediaId
      return (
        event.mediaPublishedAt !== null &&
        event.mediaPublishedAt.getTime() > candidate.publishedAt.getTime()
      )
  }
}

function storyMatches(
  trigger: TriggerOf<'story_reply'>,
  event: Extract<InboundForMatch, { kind: 'story' }>,
): boolean {
  if (event.isReaction) return trigger.includeReactions
  if (!trigger.keywords || trigger.keywords.length === 0) return true
  return event.text !== null && matchesAnyKeyword(event.text, trigger.keywords, 'contains')
}
