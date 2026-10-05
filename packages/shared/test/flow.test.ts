import { describe, expect, it } from 'vitest'
import { FlowDefinitionSchema, StepSchema, TriggerSchema } from '../src'

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
