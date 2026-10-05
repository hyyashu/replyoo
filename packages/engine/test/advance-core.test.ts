import type { FlowDefinition } from '@replyooo/shared'
import { describe, expect, it } from 'vitest'
import { advance, newRunState } from '../src'
import { Driver, T0, dmFlow, makeContact } from './helpers'

describe('advance: linear steps', () => {
  it('runs send_message → tag → end and completes', () => {
    const driver = new Driver(
      dmFlow({
        s1: { type: 'send_message', text: 'Hi {{first_name|there}}', next: 's2' },
        s2: { type: 'tag', add: ['greeted'] },
      }),
    )
    const result = driver.startDm()
    expect(result.ignored).toBe(false)
    expect(result.effects).toEqual([
      { type: 'send', message: { text: 'Hi Priya' } },
      { type: 'update_contact', patch: { addTags: ['greeted'] } },
    ])
    expect(result.run.status).toBe('completed')
    expect(result.run.stateVersion).toBe(1)
  })

  it('includes image and url buttons in the outbound message', () => {
    const driver = new Driver(
      dmFlow({
        s1: {
          type: 'send_message',
          text: 'Look',
          imageUrl: 'https://example.com/a.png',
          buttons: [{ type: 'url', label: 'Open', url: 'https://example.com' }],
        },
      }),
    )
    driver.startDm()
    expect(driver.effects).toEqual([
      {
        type: 'send',
        message: {
          text: 'Look',
          imageUrl: 'https://example.com/a.png',
          buttons: [{ type: 'url', label: 'Open', url: 'https://example.com' }],
        },
      },
    ])
    expect(driver.run.status).toBe('completed')
  })

  it('branches on condition', () => {
    const flow = dmFlow({
      s1: { type: 'condition', has: 'email', yes: 'known', no: 'unknown' },
      known: { type: 'send_message', text: 'known' },
      unknown: { type: 'send_message', text: 'unknown' },
    })
    const withEmail = new Driver(flow, makeContact({ email: 'a@b.co' }))
    withEmail.startDm()
    expect(withEmail.sentTexts()).toEqual(['known'])

    const withoutEmail = new Driver(flow)
    withoutEmail.startDm()
    expect(withoutEmail.sentTexts()).toEqual(['unknown'])
  })

  it('condition sees tags added earlier in the same run', () => {
    const driver = new Driver(
      dmFlow({
        s1: { type: 'tag', add: ['vip'], next: 's2' },
        s2: { type: 'condition', has: { tag: 'vip' }, yes: 'vip' },
        vip: { type: 'send_message', text: 'vip!' },
      }),
    )
    driver.startDm()
    expect(driver.sentTexts()).toEqual(['vip!'])
  })

  it('fails with step_budget_exceeded on a runaway loop', () => {
    const driver = new Driver(
      dmFlow({
        s1: { type: 'tag', add: ['a'], next: 's2' },
        s2: { type: 'tag', add: ['b'], next: 's1' },
      }),
    )
    const result = driver.startDm()
    expect(result.run.status).toBe('failed')
    expect(result.run.error).toBe('step_budget_exceeded')
  })

  it('fails when a step is missing', () => {
    const driver = new Driver(dmFlow({ s1: { type: 'send_message', text: 'x', next: 'nope' } }))
    expect(driver.startDm().run.error).toBe('missing_step:nope')
  })
})

describe('advance: comment trigger', () => {
  const commentFlow: FlowDefinition = {
    trigger: {
      type: 'comment_keyword',
      posts: { mode: 'any' },
      keywords: ['GUIDE'],
      match: 'contains',
      publicReplies: ['Check your DMs {{first_name}}!', 'Sent!'],
    },
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

  it('publicly replies and sends the opener as a private reply', () => {
    const driver = new Driver(commentFlow)
    const result = driver.startComment('c42')
    expect(result.effects.slice(0, 2)).toEqual([
      { type: 'comment_reply', commentId: 'c42', text: 'Check your DMs Priya!' },
      {
        type: 'private_reply',
        commentId: 'c42',
        message: {
          text: 'Tap below',
          buttons: [{ type: 'reply', label: 'Send it', stepId: 'opener', buttonId: 'yes' }],
        },
      },
    ])
    expect(result.run.outbound).toBe('blocked')
    expect(result.run.commentId).toBe('c42')
  })

  it('second send in a comment flow before a tap fails', () => {
    const flow: FlowDefinition = {
      ...commentFlow,
      steps: {
        opener: { type: 'send_message', text: 'one', next: 'two' },
        two: { type: 'send_message', text: 'two' },
      },
    }
    const driver = new Driver(flow)
    const result = driver.startComment()
    expect(driver.effects.filter((e) => e.type === 'send')).toEqual([])
    expect(result.run.status).toBe('failed')
    expect(result.run.error).toBe('messaging_window_closed')
  })
})

describe('advance: ice breaker trigger', () => {
  it('starts at the tapped item start step', () => {
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
    const driver = new Driver(flow)
    driver.send({ type: 'start', trigger: { kind: 'ice_breaker', itemIndex: 1 } })
    expect(driver.sentTexts()).toEqual(['9-5'])
  })
})

describe('advance: events on non-waiting runs', () => {
  it('ignores replies to a completed run and returns the input run unchanged', () => {
    const run = { ...newRunState(), status: 'completed' as const, stateVersion: 3 }
    const result = advance({
      run,
      flow: dmFlow({ s1: { type: 'send_message', text: 'x' } }),
      contact: makeContact(),
      event: { type: 'reply', text: 'hello' },
      now: T0,
    })
    expect(result).toEqual({ run, effects: [], ignored: true })
  })
})
