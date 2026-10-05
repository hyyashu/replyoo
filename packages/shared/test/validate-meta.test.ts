import { describe, expect, it } from 'vitest'
import type { FlowDefinition, StepOf } from '../src'
import { MAX_BUTTON_TEMPLATE_TEXT, TEMPLATES, validateFlow } from '../src'

const codes = (flow: FlowDefinition) => validateFlow(flow, 'instagram').map((issue) => issue.code)

const commentFlow = (first: StepOf<'send_message'>): FlowDefinition => ({
  trigger: { type: 'comment_keyword', posts: { mode: 'any' }, keywords: ['guide'], match: 'contains' },
  start: 's1',
  steps: { s1: first, s2: { type: 'send_message', text: 'Here is the link' } },
})

const tapButton = [{ type: 'reply' as const, id: 'b1', label: 'Send it', next: 's2' }]

describe('validateFlow: Meta message limits', () => {
  it('rejects button messages longer than the button template allows', () => {
    const flow = commentFlow({
      type: 'send_message',
      text: 'x'.repeat(MAX_BUTTON_TEMPLATE_TEXT + 1),
      buttons: tapButton,
    })
    expect(codes(flow)).toEqual(['buttons_text_too_long'])
  })

  it('accepts button messages at the limit and long plain messages', () => {
    const flow = commentFlow({ type: 'send_message', text: 'x'.repeat(MAX_BUTTON_TEMPLATE_TEXT), buttons: tapButton })
    flow.steps.s2 = { type: 'send_message', text: 'y'.repeat(1000) }
    expect(codes(flow)).toEqual([])
  })

  it('rejects an image on the first message of a comment flow', () => {
    const flow = commentFlow({
      type: 'send_message',
      text: 'Tap below',
      imageUrl: 'https://cdn.example.com/a.jpg',
      buttons: tapButton,
    })
    expect(codes(flow)).toEqual(['comment_first_message_image'])
  })

  it('allows images on later messages', () => {
    const flow = commentFlow({ type: 'send_message', text: 'Tap below', buttons: tapButton })
    flow.steps.s2 = { type: 'send_message', text: 'Here', imageUrl: 'https://cdn.example.com/a.jpg' }
    expect(codes(flow)).toEqual([])
  })

  it('keeps every v1 template valid', () => {
    for (const template of TEMPLATES) {
      for (const platform of template.platforms) {
        expect(validateFlow(template.flow, platform), template.key).toEqual([])
      }
    }
  })
})
