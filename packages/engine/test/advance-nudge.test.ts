import { describe, expect, it } from 'vitest'
import { Driver, POSTBACK_MINUTES, T0, addMinutes, dmFlow } from './helpers'

const askFlow = dmFlow({
  s1: {
    type: 'ask',
    question: 'Email?',
    saveTo: 'email',
    validate: 'email',
    retryText: 'Try again',
    maxAttempts: 3,
    timeoutMinutes: 1440,
    nudge: { afterMinutes: 120, text: 'Still there?' },
    answered: 's2',
  },
  s2: { type: 'send_message', text: 'Thanks' },
})

const buttonFlow = dmFlow({
  s1: {
    type: 'send_message',
    text: 'Tap to continue',
    buttons: [{ type: 'reply', id: 'go', label: 'Go', next: 's2' }],
    nudge: { afterMinutes: 60, text: 'Reminder 👋' },
  },
  s2: { type: 'send_message', text: 'Here you go' },
})

describe('nudge', () => {
  it('wakes at the reminder time, remembering the real deadline', () => {
    const driver = new Driver(buttonFlow)
    const result = driver.startDm()
    expect(result.effects).toContainEqual({ type: 'schedule_timeout', at: addMinutes(T0, 60) })
    expect(result.run.wait).toEqual({ kind: 'postback', nudgeDeadline: addMinutes(T0, POSTBACK_MINUTES).toISOString() })
  })

  it('sends the reminder once, then waits out the original window and expires', () => {
    const driver = new Driver(buttonFlow)
    driver.startDm()
    driver.tick(60)
    const nudged = driver.send({ type: 'timeout' })
    expect(driver.sentTexts()).toEqual(['Reminder 👋'])
    expect(nudged.effects).toContainEqual({ type: 'schedule_timeout', at: addMinutes(T0, POSTBACK_MINUTES) })
    expect(nudged.run).toMatchObject({ status: 'waiting', wait: { kind: 'postback' } })
    expect(nudged.run.wait).not.toHaveProperty('nudgeDeadline')

    driver.tick(POSTBACK_MINUTES - 60)
    driver.send({ type: 'timeout' })
    expect(driver.sentTexts()).toEqual([])
    expect(driver.run.status).toBe('expired')
  })

  it('tapping the button before the reminder cancels it', () => {
    const driver = new Driver(buttonFlow)
    driver.startDm()
    driver.tick(10)
    driver.send({ type: 'postback', stepId: 's1', buttonId: 'go' })
    expect(driver.sentTexts()).toEqual(['Here you go'])
    driver.tick(60)
    expect(driver.send({ type: 'timeout' }).ignored).toBe(true)
  })

  it('an early timeout does not send the reminder', () => {
    const driver = new Driver(buttonFlow)
    driver.startDm()
    driver.tick(59)
    expect(driver.send({ type: 'timeout' }).ignored).toBe(true)
  })

  it('works for questions, and an invalid answer keeps the reminder pending', () => {
    const driver = new Driver(askFlow)
    driver.startDm()
    driver.tick(30)
    driver.send({ type: 'reply', text: 'nope' })
    expect(driver.sentTexts()).toEqual(['Try again'])
    expect(driver.run.wait).toMatchObject({ kind: 'reply', attempts: 1, nudgeDeadline: expect.any(String) })

    driver.tick(90)
    driver.send({ type: 'timeout' })
    expect(driver.sentTexts()).toEqual(['Still there?'])
    expect(driver.run.wait).toMatchObject({ kind: 'reply', attempts: 1 })

    driver.send({ type: 'reply', text: 'a@b.co' })
    expect(driver.run.status).toBe('completed')
  })

  it('is skipped (no message) when only a comment private reply has been sent', () => {
    const driver = new Driver({
      trigger: { type: 'comment_keyword', posts: { mode: 'any' }, keywords: [], match: 'contains' },
      start: 's1',
      steps: buttonFlow.steps,
    })
    driver.startComment()
    driver.tick(60)
    const result = driver.send({ type: 'timeout' })
    expect(driver.sentTexts()).toEqual([])
    expect(result.run.status).toBe('waiting')
  })

  it('ignores a reminder that would land after the wait ends', () => {
    const driver = new Driver(
      dmFlow({
        s1: {
          type: 'ask',
          question: 'Phone?',
          saveTo: 'phone',
          validate: 'phone',
          retryText: 'Again',
          maxAttempts: 1,
          timeoutMinutes: 60,
          nudge: { afterMinutes: 90, text: 'late' },
        },
      }),
    )
    const result = driver.startDm()
    expect(result.run.wait).toEqual({ kind: 'reply', attempts: 0 })
    expect(result.effects).toContainEqual({ type: 'schedule_timeout', at: addMinutes(T0, 60) })
  })
})
