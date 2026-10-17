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

  it('allows check_follow on facebook (the worker runs it on trust) but rejects story_reply', () => {
    const followFlow: FlowDefinition = {
      trigger: { type: 'any_dm' },
      start: 'check',
      steps: { check: { type: 'check_follow' } },
    }
    expect(codes(followFlow, 'facebook')).toEqual([])
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

describe('validateFlow: nudges', () => {
  const nudge = { afterMinutes: 60, text: 'Still there?' }
  const withOpenerNudge = (flow: FlowDefinition): FlowDefinition => ({
    ...flow,
    steps: { ...flow.steps, opener: { ...flow.steps.opener!, nudge } as never },
  })

  it('rejects a reminder on the opener of a comment flow', () => {
    expect(codes(withOpenerNudge(validCommentFlow))).toContain('nudge_after_private_reply')
  })

  it('accepts a reminder on a DM opener', () => {
    const flow = withOpenerNudge({ ...validCommentFlow, trigger: { type: 'any_dm' } })
    expect(validateFlow(flow, 'instagram')).toEqual([])
  })

  it('rejects a reminder on a message without reply buttons', () => {
    const flow: FlowDefinition = {
      trigger: { type: 'any_dm' },
      start: 's1',
      steps: { s1: { type: 'send_message', text: 'Hi', nudge } },
    }
    expect(codes(flow)).toContain('nudge_without_wait')
  })

  it('rejects a reminder that is not before the question times out', () => {
    const flow: FlowDefinition = {
      trigger: { type: 'any_dm' },
      start: 's1',
      steps: {
        s1: {
          type: 'ask',
          question: 'Email?',
          saveTo: 'email',
          validate: 'email',
          retryText: 'Again',
          maxAttempts: 2,
          timeoutMinutes: 60,
          nudge,
        },
      },
    }
    expect(codes(flow)).toContain('nudge_too_late')
  })
})

describe('send_products validation', () => {
  const mug = { title: 'Mug', button: { label: 'Buy', url: 'https://shop.example.com/mug' } }
  const carouselFlow: FlowDefinition = {
    trigger: { type: 'any_dm' },
    start: 's1',
    steps: {
      s1: { type: 'send_products', cards: [mug], next: 's2' },
      s2: { type: 'send_message', text: 'Questions? Just reply.' },
    },
  }

  it('accepts a carousel on Instagram and follows its next step', () => {
    expect(validateFlow(carouselFlow, 'instagram')).toEqual([])
  })

  it('reports a missing next step and an unreachable step like any other step', () => {
    const missing: FlowDefinition = {
      ...carouselFlow,
      steps: { ...carouselFlow.steps, s1: { type: 'send_products', cards: [mug], next: 'ghost' } },
    }
    expect(codes(missing)).toContain('missing_target')
    expect(codes(missing)).toContain('orphan_step')
  })

  it('flags a carousel on Facebook once', () => {
    const twice: FlowDefinition = {
      ...carouselFlow,
      steps: { ...carouselFlow.steps, s2: { type: 'send_products', cards: [mug] } },
    }
    expect(codes(twice, 'facebook').filter((code) => code === 'carousel_unsupported')).toHaveLength(1)
    expect(codes(carouselFlow, 'instagram')).not.toContain('carousel_unsupported')
  })

  it('does not accept a carousel as the first message after a comment', () => {
    const flow: FlowDefinition = {
      trigger: { type: 'comment_keyword', posts: { mode: 'any' }, keywords: ['SHOP'], match: 'contains' },
      start: 's1',
      steps: carouselFlow.steps,
    }
    expect(codes(flow)).toContain('comment_needs_reply_button')
  })
})

describe('validateFlow: click follow-ups', () => {
  const clickFollowUp = { afterMinutes: 60, text: 'Did you get a chance to look?' }
  const link = { type: 'url' as const, label: 'Open', url: 'https://example.com/guide' }

  it('accepts a follow-up on a link message after the opener', () => {
    const flow: FlowDefinition = {
      ...validCommentFlow,
      steps: { ...validCommentFlow.steps, deliver: { type: 'send_message', text: 'Here', buttons: [link], clickFollowUp } },
    }
    expect(validateFlow(flow, 'instagram')).toEqual([])
  })

  it('accepts a follow-up on a carousel', () => {
    const flow: FlowDefinition = {
      ...validCommentFlow,
      steps: {
        ...validCommentFlow.steps,
        deliver: { type: 'send_products', cards: [{ title: 'Guide', button: { label: 'Get it', url: link.url } }], clickFollowUp },
      },
    }
    expect(validateFlow(flow, 'instagram')).toEqual([])
  })

  it('rejects a follow-up on a message with no link button', () => {
    const flow: FlowDefinition = {
      trigger: { type: 'any_dm' },
      start: 's1',
      steps: { s1: { type: 'send_message', text: 'Hi', clickFollowUp } },
    }
    expect(codes(flow)).toContain('click_follow_up_without_links')
  })

  it("rejects a follow-up on a comment flow's first message", () => {
    const flow: FlowDefinition = {
      trigger: validCommentFlow.trigger,
      start: 's1',
      steps: { s1: { type: 'send_message', text: 'Here', buttons: [link], clickFollowUp } },
    }
    expect(codes(flow)).toContain('click_follow_up_after_private_reply')
  })

  it('rejects a follow-up text too long to sit above link buttons', () => {
    const flow: FlowDefinition = {
      trigger: { type: 'any_dm' },
      start: 's1',
      steps: { s1: { type: 'send_message', text: 'Here', buttons: [link], clickFollowUp: { afterMinutes: 60, text: 'x'.repeat(641) } } },
    }
    expect(codes(flow)).toContain('buttons_text_too_long')
  })

  it('accepts a follow-up on the first message of a DM flow', () => {
    const flow: FlowDefinition = {
      trigger: { type: 'any_dm' },
      start: 's1',
      steps: { s1: { type: 'send_message', text: 'Here', buttons: [link], clickFollowUp } },
    }
    expect(validateFlow(flow, 'instagram')).toEqual([])
  })
})
