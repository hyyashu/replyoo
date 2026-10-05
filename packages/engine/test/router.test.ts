import type { Trigger } from '@replyooo/shared'
import { describe, expect, it } from 'vitest'
import type { TriggerCandidate } from '../src'
import { matchAutomation } from '../src'

let n = 0
const candidate = (trigger: Trigger, publishedAt = '2026-01-01', extra: Partial<TriggerCandidate> = {}) =>
  ({ automationId: `a${++n}`, publishedAt: new Date(publishedAt), trigger, ...extra }) satisfies TriggerCandidate

const commentAny = (keywords: string[]) =>
  ({ type: 'comment_keyword', posts: { mode: 'any' }, keywords, match: 'contains' }) as const

describe('matchAutomation: comments', () => {
  it('matches comment keywords on any post', () => {
    const c = candidate(commentAny(['guide']))
    expect(
      matchAutomation({ kind: 'comment', text: 'GUIDE pls', mediaId: 'm1', mediaPublishedAt: null }, [c]),
    ).toBe(c)
  })

  it('respects specific post scope', () => {
    const c = candidate({
      type: 'comment_keyword',
      posts: { mode: 'specific', mediaIds: ['m1'] },
      keywords: ['guide'],
      match: 'contains',
    })
    const event = { kind: 'comment' as const, text: 'guide', mediaPublishedAt: null }
    expect(matchAutomation({ ...event, mediaId: 'm1' }, [c])).toBe(c)
    expect(matchAutomation({ ...event, mediaId: 'm2' }, [c])).toBeNull()
  })

  it('next-post mode matches posts published after the automation, or the pinned post', () => {
    const trigger: Trigger = {
      type: 'comment_keyword',
      posts: { mode: 'next' },
      keywords: ['guide'],
      match: 'contains',
    }
    const unpinned = candidate(trigger, '2026-03-01')
    const event = { kind: 'comment' as const, text: 'guide', mediaId: 'm9' }
    expect(matchAutomation({ ...event, mediaPublishedAt: new Date('2026-03-02') }, [unpinned])).toBe(unpinned)
    expect(matchAutomation({ ...event, mediaPublishedAt: new Date('2026-02-01') }, [unpinned])).toBeNull()
    expect(matchAutomation({ ...event, mediaPublishedAt: null }, [unpinned])).toBeNull()

    const pinned = candidate(trigger, '2026-03-01', { pinnedMediaId: 'm9' })
    expect(matchAutomation({ ...event, mediaPublishedAt: null }, [pinned])).toBe(pinned)
    expect(matchAutomation({ ...event, mediaId: 'm10', mediaPublishedAt: new Date('2026-04-01') }, [pinned])).toBeNull()
  })

  it('picks the most recently published match', () => {
    const older = candidate(commentAny(['guide']), '2026-01-01')
    const newer = candidate(commentAny(['guide']), '2026-02-01')
    expect(
      matchAutomation({ kind: 'comment', text: 'guide', mediaId: 'm1', mediaPublishedAt: null }, [older, newer]),
    ).toBe(newer)
  })

  it('does not let DM automations match comments', () => {
    const dm = candidate({ type: 'any_dm' })
    expect(matchAutomation({ kind: 'comment', text: 'hi', mediaId: 'm1', mediaPublishedAt: null }, [dm])).toBeNull()
  })
})

describe('matchAutomation: DMs', () => {
  const keyword = candidate({ type: 'dm_keyword', keywords: ['price'], match: 'contains' }, '2026-01-01')
  const fallback = candidate({ type: 'any_dm' }, '2026-06-01')

  it('prefers keyword automations over any_dm even if any_dm is newer', () => {
    expect(matchAutomation({ kind: 'dm', text: 'price?' }, [fallback, keyword])).toBe(keyword)
  })

  it('falls back to any_dm', () => {
    expect(matchAutomation({ kind: 'dm', text: 'hello' }, [keyword, fallback])).toBe(fallback)
  })

  it('returns null when nothing matches', () => {
    expect(matchAutomation({ kind: 'dm', text: 'hello' }, [keyword])).toBeNull()
  })

  it('never matches ice breaker automations', () => {
    const ib = candidate({ type: 'ice_breaker', items: [{ question: 'Q', startStep: 's1' }] })
    expect(matchAutomation({ kind: 'dm', text: 'Q' }, [ib])).toBeNull()
  })
})

describe('matchAutomation: stories', () => {
  const story = candidate({ type: 'story_reply', includeReactions: false, keywords: ['want'] })
  const reactions = candidate({ type: 'story_reply', includeReactions: true })
  const fallback = candidate({ type: 'any_dm' })

  it('matches story replies by keyword', () => {
    expect(matchAutomation({ kind: 'story', text: 'I want this', isReaction: false }, [story])).toBe(story)
  })

  it('only matches reactions when includeReactions is on', () => {
    expect(matchAutomation({ kind: 'story', text: null, isReaction: true }, [story])).toBeNull()
    expect(matchAutomation({ kind: 'story', text: null, isReaction: true }, [story, reactions])).toBe(reactions)
  })

  it('falls back to DM automations for text story replies, never for reactions', () => {
    expect(matchAutomation({ kind: 'story', text: 'nice', isReaction: false }, [story, fallback])).toBe(fallback)
    expect(matchAutomation({ kind: 'story', text: null, isReaction: true }, [fallback])).toBeNull()
  })
})
