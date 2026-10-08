import type { FlowDefinition, StepOf } from '@replyooo/shared'
import { describe, expect, it } from 'vitest'
import type { FlowRunState } from '../src'
import { advance, newRunState } from '../src'
import { FOLLOW_CHECK_WAIT_MINUTES, MAX_STEPS_PER_ADVANCE } from '../src/types'
import { Driver, POSTBACK_MINUTES, T0, addMinutes, dmFlow, makeContact } from './helpers'

const commentFlow = (steps: FlowDefinition['steps'], publicReplies?: string[], start = 's1'): FlowDefinition => ({
  trigger: {
    type: 'comment_keyword',
    posts: { mode: 'any' },
    keywords: ['guide'],
    match: 'contains',
    ...(publicReplies ? { publicReplies } : {}),
  },
  start,
  steps,
})

const tagChain = (length: number): FlowDefinition['steps'] => {
  const steps: FlowDefinition['steps'] = {}
  for (let i = 1; i <= length; i++) {
    steps[`t${i}`] = { type: 'tag', add: [`x${i}`], ...(i < length ? { next: `t${i + 1}` } : {}) }
  }
  return steps
}

const buttonStep = (next = 's2'): StepOf<'send_message'> => ({
  type: 'send_message',
  text: 'Tap',
  buttons: [{ type: 'reply', id: 'go', label: 'Send it', next }],
})

describe('advance edge: graph shape', () => {
  it('fails with missing_step when the start step does not exist', () => {
    const driver = new Driver(dmFlow({ s1: { type: 'send_message', text: 'hi' } }, 'nope'))
    const result = driver.startDm()
    expect(result.run).toMatchObject({ status: 'failed', error: 'missing_step:nope' })
    expect(result.effects).toEqual([])
  })

  it('fails with missing_step on a dangling next, keeping earlier effects', () => {
    const driver = new Driver(dmFlow({ s1: { type: 'send_message', text: 'hi', next: 'gone' } }))
    const result = driver.startDm()
    expect(result.run).toMatchObject({ status: 'failed', error: 'missing_step:gone', currentStepId: 's1' })
    expect(driver.sentTexts()).toEqual(['hi'])
  })

  it('a step without next completes the run', () => {
    const driver = new Driver(dmFlow({ s1: { type: 'tag', add: ['a'] } }))
    expect(driver.startDm().run).toMatchObject({ status: 'completed', currentStepId: null, wait: null, waitUntil: null })
  })

  it('a self-looping tag step hits the step budget', () => {
    const driver = new Driver(dmFlow({ s1: { type: 'tag', add: ['a'], next: 's1' } }))
    const result = driver.startDm()
    expect(result.run).toMatchObject({ status: 'failed', error: 'step_budget_exceeded' })
    expect(result.effects.filter((e) => e.type === 'update_contact')).toHaveLength(MAX_STEPS_PER_ADVANCE)
  })

  it('a two-step condition cycle hits the step budget', () => {
    const driver = new Driver(
      dmFlow({ s1: { type: 'condition', has: 'email', yes: 's2', no: 's2' }, s2: { type: 'tag', next: 's1' } }),
    )
    expect(driver.startDm().run).toMatchObject({ status: 'failed', error: 'step_budget_exceeded' })
  })

  it('exactly MAX_STEPS_PER_ADVANCE steps complete; one more fails', () => {
    const ok = new Driver(dmFlow(tagChain(MAX_STEPS_PER_ADVANCE), 't1'))
    expect(ok.startDm().run.status).toBe('completed')
    const over = new Driver(dmFlow(tagChain(MAX_STEPS_PER_ADVANCE + 1), 't1'))
    expect(over.startDm().run).toMatchObject({ status: 'failed', error: 'step_budget_exceeded' })
  })

  it('the step budget resets on every advance call (loop through a wait is fine)', () => {
    const driver = new Driver(
      dmFlow({ s1: { type: 'delay', minutes: 1, next: 's2' }, s2: { type: 'tag', add: ['a'], next: 's1' } }),
    )
    driver.startDm()
    for (let i = 0; i < MAX_STEPS_PER_ADVANCE + 5; i++) {
      driver.tick(1)
      expect(driver.send({ type: 'timeout' }).run.status).toBe('waiting')
    }
  })

  it('condition with undefined yes/no branches completes', () => {
    const yes = new Driver(dmFlow({ s1: { type: 'condition', has: 'email' } }), makeContact({ email: 'a@b.co' }))
    expect(yes.startDm().run.status).toBe('completed')
    const no = new Driver(dmFlow({ s1: { type: 'condition', has: 'phone' } }))
    expect(no.startDm().run.status).toBe('completed')
  })

  it('condition by tag sees tags added earlier in the same advance', () => {
    const driver = new Driver(
      dmFlow({
        s1: { type: 'tag', add: ['vip'], next: 's2' },
        s2: { type: 'condition', has: { tag: 'vip' }, yes: 'y', no: 'n' },
        y: { type: 'send_message', text: 'yes' },
        n: { type: 'send_message', text: 'no' },
      }),
    )
    driver.startDm()
    expect(driver.sentTexts()).toEqual(['yes'])
  })

  // BUG: evaluate() reads contact.fields[key] on a plain object; FieldKey allows "constructor",
  // so a contact without that field takes the "yes" branch.
  it('BUG: condition by field does not treat Object.prototype keys as set', () => {
    const driver = new Driver(
      dmFlow({
        s1: { type: 'condition', has: { field: 'constructor' }, yes: 'y', no: 'n' },
        y: { type: 'send_message', text: 'yes' },
        n: { type: 'send_message', text: 'no' },
      }),
    )
    driver.startDm()
    expect(driver.sentTexts()).toEqual(['no'])
  })

  it('tag add + remove of the same tag: engine and patch agree (net add)', () => {
    const driver = new Driver(dmFlow({ s1: { type: 'tag', add: ['a'], remove: ['a'] } }), makeContact({ tags: ['a'] }))
    const result = driver.startDm()
    expect(result.effects).toContainEqual({ type: 'update_contact', patch: { addTags: ['a'], removeTags: ['a'] } })
    expect(driver.contact.tags).toEqual(['a'])
  })

  it('empty tag step emits no effect', () => {
    const driver = new Driver(dmFlow({ s1: { type: 'tag', add: [], remove: [] } }))
    expect(driver.startDm().effects).toEqual([])
  })

  it('delay -> tag -> delay chain waits twice then completes', () => {
    const driver = new Driver(
      dmFlow({
        s1: { type: 'delay', minutes: 10, next: 's2' },
        s2: { type: 'tag', add: ['a'], next: 's3' },
        s3: { type: 'delay', minutes: 5 },
      }),
    )
    driver.startDm()
    expect(driver.run).toMatchObject({ status: 'waiting', currentStepId: 's1', waitUntil: addMinutes(T0, 10) })
    driver.tick(10)
    driver.send({ type: 'timeout' })
    expect(driver.run).toMatchObject({ status: 'waiting', currentStepId: 's3', waitUntil: addMinutes(T0, 15) })
    expect(driver.contact.tags).toEqual(['a'])
    driver.tick(5)
    expect(driver.send({ type: 'timeout' }).run.status).toBe('completed')
  })
})

describe('advance edge: state bookkeeping', () => {
  it('ignored results return the same run object and no effects', () => {
    const run = newRunState()
    const result = advance({
      run,
      flow: dmFlow({ s1: { type: 'send_message', text: 'hi' } }),
      contact: makeContact(),
      event: { type: 'timeout' },
      now: T0,
    })
    expect(result.ignored).toBe(true)
    expect(result.run).toBe(run)
    expect(result.effects).toEqual([])
  })

  it('stateVersion increments by exactly one per applied event', () => {
    const driver = new Driver(dmFlow({ s1: { type: 'delay', minutes: 1, next: 's2' }, s2: { type: 'delay', minutes: 1 } }))
    driver.run = { ...driver.run, stateVersion: 7 }
    driver.startDm()
    expect(driver.run.stateVersion).toBe(8)
    driver.tick(1)
    driver.send({ type: 'timeout' })
    expect(driver.run.stateVersion).toBe(9)
  })

  it('does not mutate the input run or contact', () => {
    const run: FlowRunState = {
      ...newRunState(),
      status: 'waiting',
      currentStepId: 's1',
      wait: { kind: 'reply', attempts: 0 },
      waitUntil: addMinutes(T0, 60),
      vars: { a: '1' },
    }
    const contact = makeContact({ tags: ['old'], fields: { f: 'x' } })
    const runCopy = structuredClone(run)
    const contactCopy = structuredClone(contact)
    const flow = dmFlow({
      s1: {
        type: 'ask',
        question: 'Q',
        saveTo: { field: 'city' },
        validate: 'text',
        retryText: 'R',
        maxAttempts: 2,
        timeoutMinutes: 60,
        answered: 's2',
      },
      s2: { type: 'tag', add: ['new'], remove: ['old'] },
    })
    const result = advance({ run, flow, contact, event: { type: 'reply', text: 'Pune' }, now: T0 })
    expect(result.ignored).toBe(false)
    expect(run).toEqual(runCopy)
    expect(contact).toEqual(contactCopy)
    expect(result.run.vars).toEqual({ a: '1', city: 'Pune' })
  })

  it('start resets an existing run (vars, error, commentId)', () => {
    const driver = new Driver(dmFlow({ s1: { type: 'delay', minutes: 5 } }))
    driver.run = { ...newRunState(), status: 'failed', error: 'x', vars: { a: '1' }, commentId: 'c9', stateVersion: 3 }
    driver.startDm()
    expect(driver.run).toMatchObject({ status: 'waiting', error: null, vars: {}, commentId: null, stateVersion: 4 })
  })

  it('non-start events on a completed run are ignored', () => {
    const driver = new Driver(dmFlow({ s1: { type: 'send_message', text: 'hi' } }))
    driver.startDm()
    for (const event of [
      { type: 'timeout' },
      { type: 'reply', text: 'x' },
      { type: 'postback', stepId: 's1', buttonId: 'go' },
      { type: 'follow_result', following: true },
    ] as const) {
      expect(driver.send(event).ignored).toBe(true)
    }
  })
})

describe('advance edge: postback waits', () => {
  const flow = dmFlow({
    s1: {
      type: 'send_message',
      text: 'Pick',
      buttons: [
        { type: 'url', label: 'Site', url: 'https://example.com' },
        { type: 'reply', id: 'a', label: 'Option A', next: 's2' },
        { type: 'reply', id: 'b', label: 'Done' },
      ],
    },
    s2: { type: 'send_message', text: 'A chosen' },
  })

  it('ignores postbacks for the wrong step or unknown button', () => {
    const driver = new Driver(flow)
    driver.startDm()
    expect(driver.send({ type: 'postback', stepId: 's2', buttonId: 'a' }).ignored).toBe(true)
    expect(driver.send({ type: 'postback', stepId: 's1', buttonId: 'zzz' }).ignored).toBe(true)
    expect(driver.run.status).toBe('waiting')
  })

  it('a duplicate postback after the run moved on is ignored', () => {
    const driver = new Driver(flow)
    driver.startDm()
    expect(driver.send({ type: 'postback', stepId: 's1', buttonId: 'a' }).run.status).toBe('completed')
    expect(driver.send({ type: 'postback', stepId: 's1', buttonId: 'a' }).ignored).toBe(true)
  })

  it('a reply button without next completes the run', () => {
    const driver = new Driver(flow)
    driver.startDm()
    expect(driver.send({ type: 'postback', stepId: 's1', buttonId: 'b' }).run.status).toBe('completed')
  })

  it('postbacks are ignored while in a delay wait', () => {
    const driver = new Driver(dmFlow({ s1: { type: 'delay', minutes: 5 } }))
    driver.startDm()
    expect(driver.send({ type: 'postback', stepId: 's1', buttonId: 'a' }).ignored).toBe(true)
  })

  it('outbound reply buttons carry the step id and button id; url buttons do not', () => {
    const driver = new Driver(flow)
    const result = driver.startDm()
    expect(result.effects[0]).toEqual({
      type: 'send',
      message: {
        text: 'Pick',
        buttons: [
          { type: 'url', label: 'Site', url: 'https://example.com' },
          { type: 'reply', label: 'Option A', stepId: 's1', buttonId: 'a' },
          { type: 'reply', label: 'Done', stepId: 's1', buttonId: 'b' },
        ],
      },
    })
  })

  it('typed label matches across case, whitespace and punctuation', () => {
    for (const text of ['option a', '  OPTION   A  ', 'Option A!', 'option-a']) {
      const driver = new Driver(flow)
      driver.startDm()
      expect(driver.send({ type: 'reply', text }).ignored, text).toBe(false)
      expect(driver.sentTexts()).toEqual(['A chosen'])
    }
  })

  it('typed text that is not a reply-button label is ignored (url labels too)', () => {
    const driver = new Driver(flow)
    driver.startDm()
    expect(driver.send({ type: 'reply', text: 'Site' }).ignored).toBe(true)
    expect(driver.send({ type: 'reply', text: 'Option' }).ignored).toBe(true)
    expect(driver.send({ type: 'reply', text: 'Option A please' }).ignored).toBe(true)
  })

  it('typed label with emoji must include the emoji', () => {
    const emoji = dmFlow({
      s1: { type: 'send_message', text: 'Tap', buttons: [{ type: 'reply', id: 'f', label: 'I followed ✓' }] },
    })
    const driver = new Driver(emoji)
    driver.startDm()
    expect(driver.send({ type: 'reply', text: 'i followed ✓' }).ignored).toBe(false)
  })

  // BUG: normalizeText('???') === '' and normalizeText('...') === '', so any punctuation-only DM taps the button.
  it('BUG: punctuation-only text must not tap a punctuation-only button label', () => {
    const driver = new Driver(
      dmFlow({
        s1: { type: 'send_message', text: 'Questions?', buttons: [{ type: 'reply', id: 'q', label: '???', next: 's2' }] },
        s2: { type: 'send_message', text: 'tapped' },
      }),
    )
    driver.startDm()
    expect(driver.send({ type: 'reply', text: '...' }).ignored).toBe(true)
  })

  it('postback timeout before the deadline is ignored, after it expires the run', () => {
    const driver = new Driver(flow)
    driver.startDm()
    driver.tick(POSTBACK_MINUTES - 1)
    expect(driver.send({ type: 'timeout' }).ignored).toBe(true)
    driver.tick(1)
    expect(driver.send({ type: 'timeout' }).run).toMatchObject({ status: 'expired', wait: null, waitUntil: null })
    expect(driver.send({ type: 'postback', stepId: 's1', buttonId: 'a' }).ignored).toBe(true)
  })
})

describe('advance edge: ask', () => {
  const ask = (overrides: Record<string, unknown> = {}): FlowDefinition =>
    dmFlow({
      s1: {
        type: 'ask',
        question: 'Email?',
        saveTo: 'email',
        validate: 'email',
        retryText: 'Try again',
        maxAttempts: 2,
        timeoutMinutes: 60,
        answered: 'ok',
        invalid: 'bad',
        timeout: 'late',
        ...overrides,
      } as FlowDefinition['steps'][string],
      ok: { type: 'send_message', text: 'Got {{email}} / {{vars.email}}' },
      bad: { type: 'send_message', text: 'invalid' },
      late: { type: 'send_message', text: 'late' },
    })

  it('maxAttempts 1: the first invalid answer goes straight to invalid', () => {
    const driver = new Driver(ask({ maxAttempts: 1 }))
    driver.startDm()
    driver.send({ type: 'reply', text: 'nope' })
    expect(driver.sentTexts()).toEqual(['invalid'])
    expect(driver.run.status).toBe('completed')
  })

  it('maxAttempts 2: one retry then invalid', () => {
    const driver = new Driver(ask())
    driver.startDm()
    driver.send({ type: 'reply', text: 'nope' })
    expect(driver.sentTexts()).toEqual(['Try again'])
    expect(driver.run.wait).toEqual({ kind: 'reply', attempts: 1 })
    driver.send({ type: 'reply', text: 'still no' })
    expect(driver.sentTexts()).toEqual(['invalid'])
  })

  it('a valid answer after a retry is saved and rendered in later placeholders', () => {
    const driver = new Driver(ask())
    driver.startDm()
    driver.send({ type: 'reply', text: 'nope' })
    driver.send({ type: 'reply', text: 'Mail: PRIYA@Example.COM thanks' })
    expect(driver.sentTexts()).toEqual(['Got priya@example.com / priya@example.com'])
    expect(driver.contact.email).toBe('priya@example.com')
  })

  // BUG (low; masked by the maintenance sweeper): see comment below.
  it('BUG: a retry re-arms the timeout (schedules a timeout for the new state version)', () => {
    // The worker drops timeout jobs whose expectedVersion is stale; a retry bumps stateVersion
    // without scheduling a fresh timeout, so the original timeout job becomes a no-op.
    const driver = new Driver(ask())
    driver.startDm()
    const retry = driver.send({ type: 'reply', text: 'nope' })
    expect(retry.effects.some((e) => e.type === 'schedule_timeout')).toBe(true)
  })

  it('timeout before the deadline is ignored, at the deadline follows the timeout branch', () => {
    const driver = new Driver(ask())
    driver.startDm()
    driver.tick(59)
    expect(driver.send({ type: 'timeout' }).ignored).toBe(true)
    driver.tick(1)
    driver.send({ type: 'timeout' })
    expect(driver.sentTexts()).toEqual(['late'])
  })

  it('a retry does not extend the deadline', () => {
    const driver = new Driver(ask({ maxAttempts: 5 }))
    driver.startDm()
    driver.tick(50)
    driver.send({ type: 'reply', text: 'nope' })
    expect(driver.run.waitUntil).toEqual(addMinutes(T0, 60))
  })

  it('saveTo phone stores the compact number', () => {
    const driver = new Driver(
      dmFlow({
        s1: {
          type: 'ask',
          question: 'Phone?',
          saveTo: 'phone',
          validate: 'phone',
          retryText: 'R',
          maxAttempts: 2,
          timeoutMinutes: 60,
          answered: 's2',
        },
        s2: { type: 'send_message', text: 'Call {{phone}} {{vars.phone}}' },
      }),
    )
    driver.startDm()
    driver.send({ type: 'reply', text: '+91 (987) 654-3210' })
    expect(driver.sentTexts()).toEqual(['Call +919876543210 +919876543210'])
  })

  it('saveTo custom field is visible as fields.x and vars.x', () => {
    const driver = new Driver(
      dmFlow({
        s1: {
          type: 'ask',
          question: 'City?',
          saveTo: { field: 'city' },
          validate: 'text',
          retryText: 'R',
          maxAttempts: 2,
          timeoutMinutes: 60,
          answered: 's2',
        },
        s2: { type: 'send_message', text: '{{fields.city}}|{{vars.city}}|{{fields.other|none}}' },
      }),
      makeContact({ fields: { zip: '1' } }),
    )
    const result = driver.startDm()
    expect(result.run.wait).toEqual({ kind: 'reply', attempts: 0 })
    const answered = driver.send({ type: 'reply', text: '  Pune  ' })
    expect(answered.effects).toContainEqual({ type: 'update_contact', patch: { fields: { city: 'Pune' } } })
    expect(driver.sentTexts()).toEqual(['Pune|Pune|none'])
    expect(driver.contact.fields).toEqual({ zip: '1', city: 'Pune' })
  })

  it('an ask without branches completes on answer, invalid and timeout', () => {
    const bare = dmFlow({
      s1: {
        type: 'ask',
        question: 'Q',
        saveTo: { field: 'x' },
        validate: 'text',
        retryText: 'R',
        maxAttempts: 1,
        timeoutMinutes: 10,
      },
    })
    const a = new Driver(bare)
    a.startDm()
    expect(a.send({ type: 'reply', text: 'ok' }).run.status).toBe('completed')
    const b = new Driver(bare)
    b.startDm()
    expect(b.send({ type: 'reply', text: 'x'.repeat(501) }).run.status).toBe('completed')
    const c = new Driver(bare)
    c.startDm()
    c.tick(10)
    expect(c.send({ type: 'timeout' }).run.status).toBe('completed')
  })

  it('follow_result while waiting for a reply is ignored', () => {
    const driver = new Driver(ask())
    driver.startDm()
    expect(driver.send({ type: 'follow_result', following: true }).ignored).toBe(true)
  })
})

describe('advance edge: nudges', () => {
  const buttonsWithNudge = (afterMinutes: number) =>
    dmFlow({
      s1: { ...buttonStep(), nudge: { afterMinutes, text: 'Reminder {{first_name}}' } },
      s2: { type: 'send_message', text: 'Here' },
    })

  it('a nudge at or after the deadline is never scheduled', () => {
    const driver = new Driver(
      dmFlow({
        s1: {
          type: 'ask',
          question: 'Q',
          saveTo: { field: 'x' },
          validate: 'text',
          retryText: 'R',
          maxAttempts: 1,
          timeoutMinutes: 30,
          nudge: { afterMinutes: 30, text: 'nudge' },
        },
      }),
    )
    const result = driver.startDm()
    expect(result.run.wait).toEqual({ kind: 'reply', attempts: 0 })
    expect(result.run.waitUntil).toEqual(addMinutes(T0, 30))
  })

  it('renders placeholders in the nudge', () => {
    const driver = new Driver(buttonsWithNudge(60))
    driver.startDm()
    driver.tick(60)
    driver.send({ type: 'timeout' })
    expect(driver.sentTexts()).toEqual(['Reminder Priya'])
  })

  // BUG: onNudge never compares now with nudgeDeadline, so a late wake-up sends the reminder after the window closed.
  it('BUG: a late timeout that arrives after the real deadline does not send the reminder', () => {
    // e.g. the worker was down; the reminder job fires after the 24h window has already ended.
    const driver = new Driver(buttonsWithNudge(60))
    driver.startDm()
    driver.tick(POSTBACK_MINUTES + 30)
    const late = driver.send({ type: 'timeout' })
    expect(driver.sentTexts()).toEqual([])
    expect(late.run.status).toBe('expired')
  })

  it('no reminder while the comment private reply has blocked outbound', () => {
    const driver = new Driver(commentFlow({ s1: { ...buttonStep(), nudge: { afterMinutes: 60, text: 'nudge' } }, s2: { type: 'send_message', text: 'Here' } }))
    driver.startComment()
    expect(driver.run.outbound).toBe('blocked')
    driver.tick(60)
    const nudged = driver.send({ type: 'timeout' })
    expect(nudged.ignored).toBe(false)
    expect(driver.sentTexts()).toEqual([])
    expect(nudged.effects).toEqual([{ type: 'schedule_timeout', at: addMinutes(T0, POSTBACK_MINUTES) }])
    driver.tick(POSTBACK_MINUTES - 60)
    expect(driver.send({ type: 'timeout' }).run.status).toBe('expired')
  })

  it('a reminder is sent once only', () => {
    const driver = new Driver(buttonsWithNudge(60))
    driver.startDm()
    driver.tick(60)
    driver.send({ type: 'timeout' })
    driver.tick(1)
    expect(driver.send({ type: 'timeout' }).ignored).toBe(true)
  })
})

describe('advance edge: messaging windows', () => {
  it('a comment start sends the first message as a private reply and then blocks', () => {
    const driver = new Driver(commentFlow({ s1: buttonStep(), s2: { type: 'send_message', text: 'Here' } }))
    const result = driver.startComment('c42')
    expect(result.run).toMatchObject({ outbound: 'blocked', commentId: 'c42', status: 'waiting' })
    expect(result.effects[0]).toMatchObject({ type: 'private_reply', commentId: 'c42' })
  })

  it('two consecutive sends after a comment fail with messaging_window_closed', () => {
    const driver = new Driver(
      commentFlow({ s1: { type: 'send_message', text: 'one', next: 's2' }, s2: { type: 'send_message', text: 'two' } }),
    )
    const result = driver.startComment()
    expect(result.run).toMatchObject({ status: 'failed', error: 'messaging_window_closed', currentStepId: 's2' })
    expect(result.effects.map((e) => e.type)).toEqual(['private_reply'])
  })

  it('a button tap unblocks outbound to dm', () => {
    const driver = new Driver(commentFlow({ s1: buttonStep(), s2: { type: 'send_message', text: 'Here' } }))
    driver.startComment()
    const tap = driver.send({ type: 'postback', stepId: 's1', buttonId: 'go' })
    expect(tap.effects).toEqual([{ type: 'send', message: { text: 'Here' } }])
    expect(tap.run.outbound).toBe('dm')
  })

  it('a typed label also unblocks', () => {
    const driver = new Driver(commentFlow({ s1: buttonStep(), s2: { type: 'send_message', text: 'Here' } }))
    driver.startComment()
    driver.send({ type: 'reply', text: 'send it' })
    expect(driver.effects).toEqual([{ type: 'send', message: { text: 'Here' } }])
  })

  it('a comment flow starting with ask: question is the private reply, answer reopens dm', () => {
    const driver = new Driver(
      commentFlow({
        s1: {
          type: 'ask',
          question: 'Email?',
          saveTo: 'email',
          validate: 'email',
          retryText: 'Again',
          maxAttempts: 3,
          timeoutMinutes: 60,
          answered: 's2',
        },
        s2: { type: 'send_message', text: 'Thanks' },
      }),
    )
    driver.startComment()
    expect(driver.effects[0]).toMatchObject({ type: 'private_reply', message: { text: 'Email?' } })
    driver.send({ type: 'reply', text: 'nope' })
    // The retry also re-arms the timeout for the new state version.
    expect(driver.effects).toEqual([
      { type: 'send', message: { text: 'Again' } },
      { type: 'schedule_timeout', at: addMinutes(T0, 60) },
    ])
    driver.send({ type: 'reply', text: 'a@b.co' })
    expect(driver.sentTexts()).toEqual(['Thanks'])
  })

  it('a comment flow whose first step is a delay still sends the first message as a private reply', () => {
    const driver = new Driver(
      commentFlow({ s1: { type: 'delay', minutes: 5, next: 's2' }, s2: { type: 'send_message', text: 'Later' } }),
    )
    driver.startComment()
    driver.tick(5)
    driver.send({ type: 'timeout' })
    expect(driver.effects).toEqual([{ type: 'private_reply', commentId: 'c1', message: { text: 'Later' } }])
  })

  it('a private reply with an empty comment id fails with missing_comment_id', () => {
    const driver = new Driver(commentFlow({ s1: { type: 'send_message', text: 'x' } }))
    const result = driver.startComment('')
    expect(result.run).toMatchObject({ status: 'failed', error: 'missing_comment_id' })
  })

  it('dm/story starts use dm outbound', () => {
    const driver = new Driver(dmFlow({ s1: { type: 'send_message', text: 'x', next: 's2' }, s2: { type: 'send_message', text: 'y' } }))
    driver.send({ type: 'start', trigger: { kind: 'story', text: null } })
    expect(driver.sentTexts()).toEqual(['x', 'y'])
  })
})

describe('advance edge: public replies', () => {
  const steps: FlowDefinition['steps'] = { s1: buttonStep(), s2: { type: 'send_message', text: 'Here' } }
  const start = (flow: FlowDefinition, random: () => number) =>
    advance({
      run: newRunState(),
      flow,
      contact: makeContact(),
      event: { type: 'start', trigger: { kind: 'comment', commentId: 'c1', text: 'guide' } },
      now: T0,
      random,
    })
  const publicReply = (flow: FlowDefinition, random: () => number) =>
    start(flow, random).effects.find((e) => e.type === 'comment_reply')

  it('no public replies -> no comment_reply', () => {
    expect(publicReply(commentFlow(steps), () => 0.5)).toBeUndefined()
    expect(publicReply(commentFlow(steps, []), () => 0.5)).toBeUndefined()
  })

  it('one reply is always used', () => {
    for (const r of [0, 0.5, 0.999999]) {
      expect(publicReply(commentFlow(steps, ['only']), () => r)).toEqual({ type: 'comment_reply', commentId: 'c1', text: 'only' })
    }
  })

  it('picks by random() across the full [0,1) range, clamping 1', () => {
    const flow = commentFlow(steps, ['a', 'b', 'c'])
    expect(publicReply(flow, () => 0)).toMatchObject({ text: 'a' })
    expect(publicReply(flow, () => 0.34)).toMatchObject({ text: 'b' })
    expect(publicReply(flow, () => 0.9999999)).toMatchObject({ text: 'c' })
    expect(publicReply(flow, () => 1)).toMatchObject({ text: 'c' })
  })

  it('public reply comes before the private reply and renders contact placeholders', () => {
    const flow = commentFlow(steps, ['Thanks @{{username}} {{first_name|friend}}!'])
    const result = start(flow, () => 0)
    expect(result.effects.map((e) => e.type)).toEqual(['comment_reply', 'private_reply', 'schedule_timeout'])
    expect(result.effects[0]).toMatchObject({ text: 'Thanks @priya Priya!' })
  })

  it('a dm start on a comment flow does not publicly reply', () => {
    const flow = commentFlow(steps, ['x'])
    const result = advance({
      run: newRunState(),
      flow,
      contact: makeContact(),
      event: { type: 'start', trigger: { kind: 'dm', text: 'guide' } },
      now: T0,
    })
    expect(result.effects.some((e) => e.type === 'comment_reply')).toBe(false)
  })
})

describe('advance edge: ice breakers', () => {
  const flow: FlowDefinition = {
    trigger: { type: 'ice_breaker', items: [{ question: 'Price?', startStep: 'p' }, { question: 'Bad', startStep: 'gone' }] },
    start: 'p',
    steps: { p: { type: 'send_message', text: 'price' } },
  }

  it('unknown item index fails the run', () => {
    const driver = new Driver(flow)
    for (const itemIndex of [2, -1, 1.5]) {
      expect(driver.send({ type: 'start', trigger: { kind: 'ice_breaker', itemIndex } }).run).toMatchObject({
        status: 'failed',
        error: 'unknown_ice_breaker',
      })
    }
  })

  it('item pointing at a missing step fails with missing_step', () => {
    const driver = new Driver(flow)
    expect(driver.send({ type: 'start', trigger: { kind: 'ice_breaker', itemIndex: 1 } }).run.error).toBe('missing_step:gone')
  })

  it('ice breaker start on a non-ice-breaker flow fails with trigger_mismatch', () => {
    const driver = new Driver(dmFlow({ s1: { type: 'send_message', text: 'x' } }))
    expect(driver.send({ type: 'start', trigger: { kind: 'ice_breaker', itemIndex: 0 } }).run.error).toBe('trigger_mismatch')
  })
})

describe('advance edge: check_follow', () => {
  const flow = dmFlow({
    s1: { type: 'check_follow', following: 'y', notFollowing: 'n' },
    y: { type: 'send_message', text: 'yes' },
    n: { type: 'send_message', text: 'no' },
  })

  it('waits FOLLOW_CHECK_WAIT_MINUTES and emits check_follow', () => {
    const driver = new Driver(flow)
    const result = driver.startDm()
    expect(result.effects).toEqual([
      { type: 'check_follow' },
      { type: 'schedule_timeout', at: addMinutes(T0, FOLLOW_CHECK_WAIT_MINUTES) },
    ])
  })

  it('timeout fails with follow_check_timeout; a later result is ignored', () => {
    const driver = new Driver(flow)
    driver.startDm()
    driver.tick(FOLLOW_CHECK_WAIT_MINUTES)
    expect(driver.send({ type: 'timeout' }).run).toMatchObject({ status: 'failed', error: 'follow_check_timeout' })
    expect(driver.send({ type: 'follow_result', following: true }).ignored).toBe(true)
  })

  it('follow_result when not waiting on a follow check is ignored', () => {
    const driver = new Driver(dmFlow({ s1: { type: 'delay', minutes: 5 } }))
    driver.startDm()
    expect(driver.send({ type: 'follow_result', following: true }).ignored).toBe(true)
  })

  it('a reply while checking follow is ignored', () => {
    const driver = new Driver(flow)
    driver.startDm()
    expect(driver.send({ type: 'reply', text: 'hello' }).ignored).toBe(true)
  })

  it('undefined branches complete', () => {
    const bare = dmFlow({ s1: { type: 'check_follow' } })
    for (const following of [true, false]) {
      const driver = new Driver(bare)
      driver.startDm()
      expect(driver.send({ type: 'follow_result', following }).run.status).toBe('completed')
    }
  })

  it('follow-gate loop: re-tapping the same button after not following re-checks', () => {
    const gate = dmFlow({
      s1: { type: 'send_message', text: 'Follow me', buttons: [{ type: 'reply', id: 'f', label: 'Done', next: 'c' }] },
      c: { type: 'check_follow', following: 'y', notFollowing: 's1' },
      y: { type: 'send_message', text: 'yay' },
    })
    const driver = new Driver(gate)
    driver.startDm()
    driver.send({ type: 'postback', stepId: 's1', buttonId: 'f' })
    driver.send({ type: 'follow_result', following: false })
    expect(driver.sentTexts()).toEqual(['Follow me'])
    driver.send({ type: 'postback', stepId: 's1', buttonId: 'f' })
    driver.send({ type: 'follow_result', following: true })
    expect(driver.sentTexts()).toEqual(['yay'])
  })
})
