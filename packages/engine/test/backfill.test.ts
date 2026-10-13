import { describe, expect, it } from 'vitest'
import type { TriggerCandidate } from '../src'
import { classifyComments } from '../src'

const NOW = new Date('2026-10-13T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)

const comment = (id: string, text: string, createdAt: Date, mediaId = 'm1') => ({ id, mediaId, text, createdAt })

const candidate = (overrides: Partial<Extract<TriggerCandidate['trigger'], { type: 'comment_keyword' }>> = {}): TriggerCandidate => ({
  automationId: 'a1',
  publishedAt: new Date('2026-10-01T00:00:00Z'),
  trigger: { type: 'comment_keyword', posts: { mode: 'any' }, keywords: ['guide'], match: 'contains', ...overrides },
  pinnedMediaId: null,
})

describe('classifyComments', () => {
  it('puts each comment in exactly one bucket', () => {
    const comments = [
      comment('ok', 'send me the GUIDE', daysAgo(1)),
      comment('done', 'guide please', daysAgo(1)),
      comment('nope', 'love this', daysAgo(1)),
      comment('old', 'guide', daysAgo(8)),
    ]
    const result = classifyComments(comments, candidate(), new Set(['done']), NOW)
    expect(result.eligible.map((c) => c.id)).toEqual(['ok'])
    expect(result.handled.map((c) => c.id)).toEqual(['done'])
    expect(result.no_match.map((c) => c.id)).toEqual(['nope'])
    expect(result.too_old.map((c) => c.id)).toEqual(['old'])
  })

  it('returns eligible comments oldest first', () => {
    const comments = [comment('new', 'guide', daysAgo(1)), comment('mid', 'guide', daysAgo(2)), comment('first', 'guide', daysAgo(3))]
    expect(classifyComments(comments, candidate(), new Set(), NOW).eligible.map((c) => c.id)).toEqual(['first', 'mid', 'new'])
  })

  it('treats every comment on the posts as a match when the automation has no keywords', () => {
    const result = classifyComments([comment('a', 'hello', daysAgo(1))], candidate({ keywords: [] }), new Set(), NOW)
    expect(result.eligible.map((c) => c.id)).toEqual(['a'])
  })

  it('only matches the chosen posts', () => {
    const c = candidate({ posts: { mode: 'specific', mediaIds: ['m1'] } })
    const result = classifyComments([comment('in', 'guide', daysAgo(1), 'm1'), comment('out', 'guide', daysAgo(1), 'm2')], c, new Set(), NOW)
    expect(result.eligible.map((x) => x.id)).toEqual(['in'])
    expect(result.no_match.map((x) => x.id)).toEqual(['out'])
  })

  it('counts a handled comment as handled even when it is also too old', () => {
    const result = classifyComments([comment('x', 'guide', daysAgo(9))], candidate(), new Set(['x']), NOW)
    expect(result.handled).toHaveLength(1)
    expect(result.too_old).toHaveLength(0)
  })

  it('treats a comment exactly 7 days old as still eligible', () => {
    const result = classifyComments([comment('edge', 'guide', daysAgo(7))], candidate(), new Set(), NOW)
    expect(result.eligible).toHaveLength(1)
  })
})
