import type { Trigger } from '@replyooo/shared'
import { describe, expect, it } from 'vitest'
import type { InboundForMatch, TriggerCandidate } from '../src'
import { matchAutomation } from '../src'

let n = 0
const candidate = (trigger: Trigger, publishedAt = '2026-01-01T00:00:00Z', extra: Partial<TriggerCandidate> = {}) =>
  ({ automationId: `a${++n}`, publishedAt: new Date(publishedAt), trigger, ...extra }) satisfies TriggerCandidate

const comment = (keywords: string[], match: 'contains' | 'exact' = 'contains', posts: any = { mode: 'any' }) =>
  ({ type: 'comment_keyword', posts, keywords, match }) as Trigger
const dmKw = (keywords: string[], match: 'contains' | 'exact' = 'contains') =>
  ({ type: 'dm_keyword', keywords, match }) as Trigger

const onComment = (text: string, mediaId = 'm1', mediaPublishedAt: Date | null = null): InboundForMatch => ({
  kind: 'comment',
  text,
  mediaId,
  mediaPublishedAt,
})

describe('matchAutomation edge: comment precedence', () => {
  it('an older keyword automation beats a newer catch-all', () => {
    const kw = candidate(comment(['guide']), '2026-01-01')
    const all = candidate(comment([]), '2026-06-01')
    expect(matchAutomation(onComment('guide'), [all, kw])).toBe(kw)
    expect(matchAutomation(onComment('hello'), [all, kw])).toBe(all)
  })

  it('newest keyword automation wins; equal publishedAt keeps input order', () => {
    const older = candidate(comment(['guide']), '2026-01-01')
    const newer = candidate(comment(['guide']), '2026-02-01')
    expect(matchAutomation(onComment('guide'), [older, newer])).toBe(newer)
    const a = candidate(comment(['guide']), '2026-03-01')
    const b = candidate(comment(['guide']), '2026-03-01')
    expect(matchAutomation(onComment('guide'), [a, b])).toBe(a)
    expect(matchAutomation(onComment('guide'), [b, a])).toBe(b)
  })

  it('a keyword automation on another post does not block a catch-all on this post', () => {
    const kw = candidate(comment(['guide'], 'contains', { mode: 'specific', mediaIds: ['other'] }))
    const all = candidate(comment([]))
    expect(matchAutomation(onComment('guide'), [kw, all])).toBe(all)
  })

  it('does not mutate the candidate array order', () => {
    const a = candidate(comment(['x']), '2026-01-01')
    const b = candidate(comment(['x']), '2026-02-01')
    const list = [a, b]
    matchAutomation(onComment('x'), list)
    expect(list).toEqual([a, b])
  })
})

describe('matchAutomation edge: keyword matching', () => {
  const match = (text: string, keywords: string[], mode: 'contains' | 'exact' = 'contains') =>
    matchAutomation(onComment(text), [candidate(comment(keywords, mode))]) !== null

  it('contains is whole-word and case-insensitive', () => {
    expect(match('Send me the GUIDE!', ['guide'])).toBe(true)
    expect(match('guides please', ['guide'])).toBe(false)
    expect(match('#guide', ['guide'])).toBe(true)
    expect(match('free guide', ['FREE GUIDE'])).toBe(true)
    expect(match('free  ,  guide', ['free guide'])).toBe(true)
  })

  it('exact requires the whole normalized text', () => {
    expect(match('  Guide!! ', ['guide'], 'exact')).toBe(true)
    expect(match('guide pls', ['guide'], 'exact')).toBe(false)
  })

  it('accents are not folded', () => {
    expect(match('cafe', ['café'])).toBe(false)
    expect(match('CAFÉ', ['café'])).toBe(true)
  })

  it('full-width characters fold via NFKC', () => {
    expect(match('ＧＵＩＤＥ', ['guide'])).toBe(true)
  })

  it('emoji keywords match as substrings', () => {
    expect(match('🔥🔥🔥', ['🔥'])).toBe(true)
    expect(match('love it🔥', ['🔥'])).toBe(true)
  })

  // BUG: normalizeText keeps U+FE0F, so keyword "❤️" does not match a plain "❤" comment (the reverse works).
  it('BUG: heart keyword with and without the emoji variation selector', () => {
    // People type both ❤ (U+2764) and ❤️ (U+2764 U+FE0F); keyword "❤️" should match either.
    expect(match('❤️', ['❤'])).toBe(true)
    expect(match('❤', ['❤️'])).toBe(true)
  })

  it('empty or punctuation-only text does not match keywords', () => {
    expect(match('', ['guide'])).toBe(false)
    expect(match('!!!', ['guide'])).toBe(false)
  })

  it('a punctuation-only keyword never matches anything', () => {
    expect(match('!!!', ['!!!'])).toBe(false)
    expect(match('???', ['?'], 'exact')).toBe(false)
  })

  it('handles very long text', () => {
    expect(match(`${'blah '.repeat(20_000)}guide`, ['guide'])).toBe(true)
  })

  it('an empty comment matches a catch-all', () => {
    expect(matchAutomation(onComment(''), [candidate(comment([]))])).not.toBeNull()
  })
})

describe('matchAutomation edge: posts modes', () => {
  const published = '2026-05-01T00:00:00Z'
  it('specific matches listed media only', () => {
    const c = candidate(comment([], 'contains', { mode: 'specific', mediaIds: ['m1', 'm2'] }))
    expect(matchAutomation(onComment('x', 'm2'), [c])).toBe(c)
    expect(matchAutomation(onComment('x', 'm3'), [c])).toBeNull()
  })

  it('next without a pin requires media published strictly after the automation', () => {
    const c = candidate(comment([], 'contains', { mode: 'next' }), published)
    expect(matchAutomation(onComment('x', 'm1', null), [c])).toBeNull()
    expect(matchAutomation(onComment('x', 'm1', new Date(published)), [c])).toBeNull()
    expect(matchAutomation(onComment('x', 'm1', new Date('2026-04-30T00:00:00Z')), [c])).toBeNull()
    expect(matchAutomation(onComment('x', 'm1', new Date('2026-05-01T00:00:01Z')), [c])).toBe(c)
  })

  it('next with a pin only matches the pinned media, regardless of publish time', () => {
    const c = candidate(comment([], 'contains', { mode: 'next' }), published, { pinnedMediaId: 'pinned' })
    expect(matchAutomation(onComment('x', 'pinned', null), [c])).toBe(c)
    expect(matchAutomation(onComment('x', 'other', new Date('2027-01-01')), [c])).toBeNull()
  })

  it('next with pinnedMediaId null behaves as unpinned', () => {
    const c = candidate(comment([], 'contains', { mode: 'next' }), published, { pinnedMediaId: null })
    expect(matchAutomation(onComment('x', 'm1', new Date('2026-06-01')), [c])).toBe(c)
  })
})

describe('matchAutomation edge: DMs, stories and ice breakers', () => {
  it('dm keyword beats a newer any_dm', () => {
    const kw = candidate(dmKw(['price']), '2026-01-01')
    const any = candidate({ type: 'any_dm' }, '2026-09-01')
    expect(matchAutomation({ kind: 'dm', text: 'price?' }, [any, kw])).toBe(kw)
    expect(matchAutomation({ kind: 'dm', text: 'hello' }, [any, kw])).toBe(any)
    expect(matchAutomation({ kind: 'dm', text: '' }, [kw])).toBeNull()
  })

  it('comment triggers never match DMs and vice versa', () => {
    expect(matchAutomation({ kind: 'dm', text: 'guide' }, [candidate(comment(['guide']))])).toBeNull()
    expect(matchAutomation(onComment('price'), [candidate(dmKw(['price'])), candidate({ type: 'any_dm' })])).toBeNull()
  })

  it('ice breakers never match via matchAutomation', () => {
    const ib = candidate({ type: 'ice_breaker', items: [{ question: 'Hi?', startStep: 's1' }] })
    expect(matchAutomation({ kind: 'dm', text: 'Hi?' }, [ib])).toBeNull()
    expect(matchAutomation({ kind: 'story', text: 'Hi?', isReaction: false }, [ib])).toBeNull()
    expect(matchAutomation(onComment('Hi?'), [ib])).toBeNull()
  })

  it('story reactions only match includeReactions and never fall back to DM triggers', () => {
    const noReact = candidate({ type: 'story_reply', includeReactions: false })
    const any = candidate({ type: 'any_dm' })
    expect(matchAutomation({ kind: 'story', text: '🔥', isReaction: true }, [noReact, any])).toBeNull()
    const react = candidate({ type: 'story_reply', includeReactions: true, keywords: ['price'] })
    expect(matchAutomation({ kind: 'story', text: '🔥', isReaction: true }, [react])).toBe(react)
  })

  it('story keywords use contains; unmatched story text falls back to DM triggers', () => {
    const story = candidate({ type: 'story_reply', includeReactions: false, keywords: ['price'] })
    const kw = candidate(dmKw(['hours']))
    const any = candidate({ type: 'any_dm' })
    expect(matchAutomation({ kind: 'story', text: 'what price', isReaction: false }, [story, kw, any])).toBe(story)
    expect(matchAutomation({ kind: 'story', text: 'your hours?', isReaction: false }, [story, kw, any])).toBe(kw)
    expect(matchAutomation({ kind: 'story', text: 'nice', isReaction: false }, [story, kw, any])).toBe(any)
  })

  it('story with null text: keywordless story automation matches, keyworded does not, no DM fallback', () => {
    const open = candidate({ type: 'story_reply', includeReactions: false })
    const kwd = candidate({ type: 'story_reply', includeReactions: false, keywords: ['x'] })
    const any = candidate({ type: 'any_dm' })
    expect(matchAutomation({ kind: 'story', text: null, isReaction: false }, [open])).toBe(open)
    expect(matchAutomation({ kind: 'story', text: null, isReaction: false }, [kwd, any])).toBeNull()
  })

  it('story_reply with empty keyword list acts as catch-all', () => {
    const open = candidate({ type: 'story_reply', includeReactions: false, keywords: [] })
    expect(matchAutomation({ kind: 'story', text: 'anything', isReaction: false }, [open])).toBe(open)
  })
})
