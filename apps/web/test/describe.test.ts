import type { Trigger } from '@replyooo/shared'
import { describe, expect, it } from 'vitest'
import { flowSearchText, triggerChips, triggerLabel } from '@/lib/describe'

// Drafts are only loosely checked on save, so the list views must survive a trigger with missing fields.
const crafted = (trigger: unknown) => trigger as Trigger

describe('trigger labels for malformed drafts', () => {
  it('labels a comment trigger with no posts or an unknown post mode', () => {
    expect(triggerLabel(crafted({ type: 'comment_keyword' }))).toBe('Post · Comment')
    expect(triggerLabel(crafted({ type: 'comment_keyword', posts: { mode: 'sometimes' } }))).toBe('Post · Comment')
    expect(triggerLabel(crafted({ type: 'comment_keyword', posts: null }))).toBe('Post · Comment')
  })

  it('still labels well-formed triggers', () => {
    expect(triggerLabel({ type: 'comment_keyword', posts: { mode: 'next' }, keywords: [], match: 'contains' })).toBe(
      'Next post · Comment',
    )
    expect(triggerLabel({ type: 'any_dm' })).toBe('DM · Any message')
  })

  it('gives chips and search text for triggers missing their lists', () => {
    expect(triggerChips(crafted({ type: 'comment_keyword' }))).toEqual(['Any comment'])
    expect(triggerChips(crafted({ type: 'dm_keyword' }))).toEqual([])
    expect(triggerChips(crafted({ type: 'story_reply', keywords: 'LINK' }))).toEqual(['Any reply'])
    expect(triggerChips(crafted({ type: 'ice_breaker' }))).toEqual(['0 questions'])
    expect(triggerChips(crafted({ type: 'comment_keyword', keywords: ['A', 3, null] }))).toEqual(['A'])
    expect(flowSearchText('Mine', { trigger: crafted({ type: 'comment_keyword' }), start: 'a', steps: {} })).toBe('mine any comment')
  })
})
