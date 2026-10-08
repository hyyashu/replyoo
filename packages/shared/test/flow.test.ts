import { describe, expect, it } from 'vitest'
import { DraftFlowSchema, FlowDefinitionSchema, StepSchema, TriggerSchema } from '../src'

const emailFlow = {
  trigger: {
    type: 'comment_keyword',
    posts: { mode: 'any' },
    keywords: ['  GUIDE '],
    match: 'contains',
    publicReplies: ['Check your DMs!'],
  },
  start: 'opener',
  steps: {
    opener: {
      type: 'send_message',
      text: 'Want the guide?',
      buttons: [{ type: 'reply', id: 'yes', label: 'Send it to me', next: 'ask_email' }],
    },
    ask_email: {
      type: 'ask',
      question: "What's your email?",
      saveTo: 'email',
      validate: 'email',
      retryText: 'That does not look like an email.',
      maxAttempts: 2,
      timeoutMinutes: 1440,
      answered: 'deliver',
    },
    deliver: {
      type: 'send_message',
      text: 'Here you go!',
      buttons: [{ type: 'url', label: 'Open guide', url: 'https://example.com/guide' }],
    },
  },
}

describe('FlowDefinitionSchema', () => {
  it('parses a valid multi-step flow and trims keywords', () => {
    const flow = FlowDefinitionSchema.parse(emailFlow)
    expect(flow.trigger.type).toBe('comment_keyword')
    if (flow.trigger.type === 'comment_keyword') expect(flow.trigger.keywords).toEqual(['GUIDE'])
    expect(Object.keys(flow.steps)).toEqual(['opener', 'ask_email', 'deliver'])
  })

  it('rejects more than 3 buttons', () => {
    const button = { type: 'url', label: 'x', url: 'https://example.com' }
    const result = StepSchema.safeParse({
      type: 'send_message',
      text: 'hi',
      buttons: [button, button, button, button],
    })
    expect(result.success).toBe(false)
  })

  it('rejects button labels over 20 characters', () => {
    const result = StepSchema.safeParse({
      type: 'send_message',
      text: 'hi',
      buttons: [{ type: 'reply', id: 'a', label: 'x'.repeat(21) }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid URLs', () => {
    const result = StepSchema.safeParse({
      type: 'send_message',
      text: 'hi',
      buttons: [{ type: 'url', label: 'Go', url: 'not a url' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown step types', () => {
    expect(StepSchema.safeParse({ type: 'teleport' }).success).toBe(false)
  })

  it('rejects more than 4 ice breakers', () => {
    const item = { question: 'Q?', startStep: 's1' }
    const result = TriggerSchema.safeParse({
      type: 'ice_breaker',
      items: [item, item, item, item, item],
    })
    expect(result.success).toBe(false)
  })

  it('rejects delays outside 1 minute to 7 days', () => {
    expect(StepSchema.safeParse({ type: 'delay', minutes: 0 }).success).toBe(false)
    expect(StepSchema.safeParse({ type: 'delay', minutes: 10081 }).success).toBe(false)
    expect(StepSchema.safeParse({ type: 'delay', minutes: 10080 }).success).toBe(true)
  })

  it('rejects empty keyword lists', () => {
    const result = TriggerSchema.safeParse({ type: 'dm_keyword', keywords: [], match: 'exact' })
    expect(result.success).toBe(false)
  })
})

describe('DraftFlowSchema', () => {
  it('accepts a half-finished draft that the strict schema rejects', () => {
    const draft = structuredClone(emailFlow)
    ;(draft.steps.opener as { buttons: { label: string }[] }).buttons[0]!.label = ''
    expect(FlowDefinitionSchema.safeParse(draft).success).toBe(false)
    expect(DraftFlowSchema.safeParse(draft).success).toBe(true)
  })

  it('still rejects data of the wrong shape', () => {
    expect(DraftFlowSchema.safeParse({ ...emailFlow, trigger: { type: 'nope' } }).success).toBe(false)
    expect(DraftFlowSchema.safeParse({ ...emailFlow, steps: { a: { type: 'nope' } } }).success).toBe(false)
    expect(DraftFlowSchema.safeParse({ ...emailFlow, start: 'x'.repeat(65) }).success).toBe(false)
    expect(DraftFlowSchema.safeParse({ ...emailFlow, steps: { ['x'.repeat(65)]: { type: 'tag' } } }).success).toBe(false)
  })

  it('rejects a trigger missing the fields the list views read', () => {
    const withTrigger = (trigger: unknown) => DraftFlowSchema.safeParse({ ...emailFlow, trigger }).success
    expect(withTrigger({ type: 'comment_keyword' })).toBe(false)
    expect(withTrigger({ type: 'comment_keyword', posts: { mode: 'sometimes' }, keywords: [], match: 'contains' })).toBe(false)
    expect(withTrigger({ type: 'comment_keyword', posts: { mode: 'specific' }, keywords: [], match: 'contains' })).toBe(false)
    expect(withTrigger({ type: 'comment_keyword', posts: { mode: 'any' }, keywords: 'LINK', match: 'contains' })).toBe(false)
    expect(withTrigger({ type: 'dm_keyword', match: 'contains' })).toBe(false)
    expect(withTrigger({ type: 'story_reply' })).toBe(false)
    expect(withTrigger({ type: 'ice_breaker' })).toBe(false)
    expect(withTrigger({ type: 'ice_breaker', items: [{ question: 'Hi' }] })).toBe(false)
  })

  it('accepts half-finished trigger edits', () => {
    const withTrigger = (trigger: unknown) => DraftFlowSchema.safeParse({ ...emailFlow, trigger }).success
    expect(withTrigger({ type: 'comment_keyword', posts: { mode: 'specific', mediaIds: [] }, keywords: [''], match: 'exact' })).toBe(true)
    expect(withTrigger({ type: 'comment_keyword', posts: { mode: 'next' }, keywords: [], match: 'contains', publicReplies: [''] })).toBe(true)
    expect(withTrigger({ type: 'dm_keyword', keywords: [], match: 'contains' })).toBe(true)
    expect(withTrigger({ type: 'any_dm' })).toBe(true)
    expect(withTrigger({ type: 'story_reply', includeReactions: false })).toBe(true)
    expect(withTrigger({ type: 'ice_breaker', items: [{ question: '', startStep: 'answer_0' }] })).toBe(true)
  })
})
