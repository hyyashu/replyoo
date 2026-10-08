import type { FlowDefinition } from '@replyooo/shared'
import { describe, expect, it } from 'vitest'
import { Driver, T0, addMinutes, dmFlow } from './helpers'

const askEmail = (overrides: Partial<Extract<FlowDefinition['steps'][string], { type: 'ask' }>> = {}) =>
  dmFlow({
    s1: {
      type: 'ask',
      question: "What's your email, {{first_name}}?",
      saveTo: 'email',
      validate: 'email',
      retryText: 'Hmm, try again?',
      maxAttempts: 2,
      timeoutMinutes: 60,
      answered: 'thanks',
      invalid: 'gave_up',
      timeout: 'timed_out',
      ...overrides,
    },
    thanks: { type: 'send_message', text: 'Saved {{email}}' },
    gave_up: { type: 'send_message', text: 'No worries' },
    timed_out: { type: 'tag', add: ['no-email'] },
  })

describe('ask step', () => {
  it('sends the question and waits for a reply', () => {
    const driver = new Driver(askEmail())
    const result = driver.startDm()
    expect(result.effects).toEqual([
      { type: 'send', message: { text: "What's your email, Priya?" } },
      { type: 'schedule_timeout', at: addMinutes(T0, 60) },
    ])
    expect(result.run.wait).toEqual({ kind: 'reply', attempts: 0 })
  })

  it('saves a valid answer and continues at answered', () => {
    const driver = new Driver(askEmail())
    driver.startDm()
    const result = driver.send({ type: 'reply', text: 'sure: PRIYA@gmail.com' })
    expect(result.effects).toEqual([
      { type: 'update_contact', patch: { email: 'priya@gmail.com' } },
      { type: 'send', message: { text: 'Saved priya@gmail.com' } },
    ])
    expect(result.run.vars).toEqual({ email: 'priya@gmail.com' })
    expect(result.run.status).toBe('completed')
    expect(driver.contact.email).toBe('priya@gmail.com')
  })

  it('retries on an invalid answer, then takes the invalid branch', () => {
    const driver = new Driver(askEmail())
    driver.startDm()

    const first = driver.send({ type: 'reply', text: 'idk' })
    expect(first.effects).toEqual([
      { type: 'send', message: { text: 'Hmm, try again?' } },
      { type: 'schedule_timeout', at: addMinutes(T0, 60) },
    ])
    expect(first.run.wait).toEqual({ kind: 'reply', attempts: 1 })
    expect(first.run.waitUntil).toEqual(addMinutes(T0, 60))

    driver.send({ type: 'reply', text: 'still no' })
    expect(driver.sentTexts()).toEqual(['No worries'])
    expect(driver.run.status).toBe('completed')
  })

  it('takes the timeout branch when nobody answers', () => {
    const driver = new Driver(askEmail())
    driver.startDm()
    driver.tick(60)
    const result = driver.send({ type: 'timeout' })
    expect(result.effects).toEqual([{ type: 'update_contact', patch: { addTags: ['no-email'] } }])
    expect(result.run.status).toBe('completed')
  })

  it('saves text answers to a custom field', () => {
    const driver = new Driver(
      dmFlow({
        s1: {
          type: 'ask',
          question: 'Which city?',
          saveTo: { field: 'city' },
          validate: 'text',
          retryText: 'Again?',
          maxAttempts: 1,
          timeoutMinutes: 60,
          answered: 'done',
        },
        done: { type: 'send_message', text: 'Hello {{fields.city}}' },
      }),
    )
    driver.startDm()
    driver.send({ type: 'reply', text: ' Pune ' })
    expect(driver.contact.fields).toEqual({ city: 'Pune' })
    expect(driver.sentTexts()).toEqual(['Hello Pune'])
  })
})
