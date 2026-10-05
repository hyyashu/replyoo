import { describe, expect, it } from 'vitest'
import type { FlowDefinition } from '../src'
import { validateFlow } from '../src'

const codes = (flow: FlowDefinition, platform: 'instagram' | 'facebook' = 'instagram') =>
  validateFlow(flow, platform).map((issue) => issue.code)

const validCommentFlow: FlowDefinition = {
  trigger: { type: 'comment_keyword', posts: { mode: 'any' }, keywords: ['GUIDE'], match: 'contains' },
  start: 'opener',
  steps: {
    opener: {
      type: 'send_message',
      text: 'Tap below',
      buttons: [{ type: 'reply', id: 'yes', label: 'Send it', next: 'deliver' }],
    },
    deliver: { type: 'send_message', text: 'Here you go' },
  },
}

describe('validateFlow', () => {
  it('accepts a valid comment flow', () => {
    expect(validateFlow(validCommentFlow, 'instagram')).toEqual([])
    expect(validateFlow(validCommentFlow, 'facebook')).toEqual([])
  })

  it('reports a missing start step', () => {
    expect(codes({ ...validCommentFlow, start: 'nope' })).toContain('missing_start')
  })

  it('reports branch targets that do not exist', () => {
    const flow: FlowDefinition = {
      trigger: { type: 'any_dm' },
      start: 's1',
      steps: { s1: { type: 'send_message', text: 'hi', next: 'ghost' } },
    }
    expect(validateFlow(flow, 'instagram')).toEqual([
      expect.objectContaining({ code: 'missing_target', stepId: 's1' }),
    ])
  })

  it('reports unreachable steps', () => {
    const flow: FlowDefinition = {
      trigger: { type: 'any_dm' },
      start: 's1',
      steps: {
        s1: { type: 'send_message', text: 'hi' },
        lonely: { type: 'send_message', text: 'nobody gets here' },
      },
    }
    expect(validateFlow(flow, 'instagram')).toEqual([
      expect.objectContaining({ code: 'orphan_step', stepId: 'lonely' }),
    ])
  })

  it('treats ice breaker start steps as reachable', () => {
    const flow: FlowDefinition = {
      trigger: {
        type: 'ice_breaker',
        items: [
          { question: 'Price?', startStep: 'price' },
          { question: 'Hours?', startStep: 'hours' },
        ],
      },
      start: 'price',
      steps: {
        price: { type: 'send_message', text: '$10' },
        hours: { type: 'send_message', text: '9-5' },
      },
    }
    expect(validateFlow(flow, 'facebook')).toEqual([])
  })

  it('requires comment flows to open with a reply button', () => {
    const flow: FlowDefinition = {
      ...validCommentFlow,
      steps: { opener: { type: 'send_message', text: 'Here is the link' } },
    }
    expect(codes(flow)).toContain('comment_needs_reply_button')
  })

  it('rejects comment flows that open with a non-message step', () => {
    const flow: FlowDefinition = {
      ...validCommentFlow,
      start: 'tagit',
      steps: {
        tagit: { type: 'tag', add: ['x'], next: 'opener' },
        ...validCommentFlow.steps,
      },
    }
    expect(codes(flow)).toContain('comment_needs_reply_button')
  })

  it('rejects check_follow and story_reply on facebook', () => {
    const followFlow: FlowDefinition = {
      trigger: { type: 'any_dm' },
      start: 'check',
      steps: { check: { type: 'check_follow' } },
    }
    expect(codes(followFlow, 'facebook')).toEqual(['platform_unsupported'])
    expect(codes(followFlow, 'instagram')).toEqual([])

    const storyFlow: FlowDefinition = {
      trigger: { type: 'story_reply', includeReactions: true },
      start: 's1',
      steps: { s1: { type: 'send_message', text: 'thanks' } },
    }
    expect(codes(storyFlow, 'facebook')).toEqual(['platform_unsupported'])
  })

  it('requires at least one post when targeting specific posts', () => {
    const flow: FlowDefinition = {
      ...validCommentFlow,
      trigger: {
        type: 'comment_keyword',
        posts: { mode: 'specific', mediaIds: [] },
        keywords: ['GUIDE'],
        match: 'contains',
      },
    }
    expect(codes(flow)).toEqual(['no_posts_selected'])
  })

  it('rejects loops that never wait for the user', () => {
    const flow: FlowDefinition = {
      trigger: { type: 'any_dm' },
      start: 'a',
      steps: {
        a: { type: 'tag', add: ['x'], next: 'b' },
        b: { type: 'send_message', text: 'spam', next: 'a' },
      },
    }
    expect(codes(flow)).toContain('cycle_without_wait')
  })

  it('allows loops that pass through a wait step (follow-gate)', () => {
    const flow: FlowDefinition = {
      trigger: { type: 'any_dm' },
      start: 'check',
      steps: {
        check: { type: 'check_follow', following: 'deliver', notFollowing: 'nudge' },
        nudge: {
          type: 'send_message',
          text: 'Follow me first',
          buttons: [{ type: 'reply', id: 'done', label: 'I followed', next: 'check' }],
        },
        deliver: { type: 'send_message', text: 'Here you go' },
      },
    }
    expect(codes(flow)).toEqual([])
  })

  it('allows loops whose only wait is a follow check', () => {
    const flow: FlowDefinition = {
      trigger: { type: 'any_dm' },
      start: 'check',
      steps: {
        check: { type: 'check_follow', following: 'deliver', notFollowing: 'nudge' },
        nudge: { type: 'send_message', text: 'Follow me first', next: 'check' },
        deliver: { type: 'send_message', text: 'Here you go' },
      },
    }
    expect(codes(flow)).toEqual([])
  })

  it('rejects next on a message that has reply buttons', () => {
    const flow: FlowDefinition = {
      trigger: { type: 'any_dm' },
      start: 's1',
      steps: {
        s1: {
          type: 'send_message',
          text: 'pick',
          buttons: [{ type: 'reply', id: 'a', label: 'A' }],
          next: 's2',
        },
        s2: { type: 'send_message', text: 'after' },
      },
    }
    expect(codes(flow)).toContain('next_with_reply_buttons')
  })

  it('rejects saving to email without email validation', () => {
    const flow: FlowDefinition = {
      trigger: { type: 'any_dm' },
      start: 'ask',
      steps: {
        ask: {
          type: 'ask',
          question: 'Email?',
          saveTo: 'email',
          validate: 'text',
          retryText: 'again',
          maxAttempts: 2,
          timeoutMinutes: 60,
        },
      },
    }
    expect(codes(flow)).toEqual(['save_type_mismatch'])
  })
})
