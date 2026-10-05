import { describe, expect, it } from 'vitest'
import { Driver, POSTBACK_MINUTES, T0, addMinutes, dmFlow } from './helpers'

const flow = dmFlow({
  s1: {
    type: 'send_message',
    text: 'Pick one',
    buttons: [
      { type: 'reply', id: 'yes', label: 'Send it to me', next: 'yes_msg' },
      { type: 'reply', id: 'no', label: 'No thanks' },
      { type: 'url', label: 'Website', url: 'https://example.com' },
    ],
  },
  yes_msg: { type: 'send_message', text: 'Sending!' },
})

describe('reply buttons', () => {
  it('sends buttons and waits for a postback for 24h', () => {
    const driver = new Driver(flow)
    const result = driver.startDm()
    expect(result.effects).toEqual([
      {
        type: 'send',
        message: {
          text: 'Pick one',
          buttons: [
            { type: 'reply', label: 'Send it to me', stepId: 's1', buttonId: 'yes' },
            { type: 'reply', label: 'No thanks', stepId: 's1', buttonId: 'no' },
            { type: 'url', label: 'Website', url: 'https://example.com' },
          ],
        },
      },
      { type: 'schedule_timeout', at: addMinutes(T0, POSTBACK_MINUTES) },
    ])
    expect(result.run).toMatchObject({
      status: 'waiting',
      currentStepId: 's1',
      wait: { kind: 'postback' },
      waitUntil: addMinutes(T0, POSTBACK_MINUTES),
    })
  })

  it('continues at the tapped button target', () => {
    const driver = new Driver(flow)
    driver.startDm()
    const result = driver.send({ type: 'postback', stepId: 's1', buttonId: 'yes' })
    expect(driver.sentTexts()).toEqual(['Sending!'])
    expect(result.run.status).toBe('completed')
    expect(result.run.stateVersion).toBe(2)
  })

  it('ends the flow when the tapped button has no target', () => {
    const driver = new Driver(flow)
    driver.startDm()
    driver.send({ type: 'postback', stepId: 's1', buttonId: 'no' })
    expect(driver.effects).toEqual([])
    expect(driver.run.status).toBe('completed')
  })

  it('ignores postbacks for another step or unknown button', () => {
    const driver = new Driver(flow)
    driver.startDm()
    expect(driver.send({ type: 'postback', stepId: 'other', buttonId: 'yes' }).ignored).toBe(true)
    expect(driver.send({ type: 'postback', stepId: 's1', buttonId: 'ghost' }).ignored).toBe(true)
    expect(driver.run.status).toBe('waiting')
  })

  it('typing the button label counts as a tap', () => {
    const driver = new Driver(flow)
    driver.startDm()
    const result = driver.send({ type: 'reply', text: 'send it to me!' })
    expect(result.ignored).toBe(false)
    expect(driver.sentTexts()).toEqual(['Sending!'])
  })

  it('ignores unrelated text while waiting for a tap', () => {
    const driver = new Driver(flow)
    driver.startDm()
    expect(driver.send({ type: 'reply', text: 'what is this?' }).ignored).toBe(true)
    expect(driver.run.status).toBe('waiting')
  })

  it('timeout before waitUntil is ignored', () => {
    const driver = new Driver(flow)
    driver.startDm()
    driver.tick(POSTBACK_MINUTES - 1)
    expect(driver.send({ type: 'timeout' }).ignored).toBe(true)
    expect(driver.run.status).toBe('waiting')
  })

  it('expires when nobody taps within 24h', () => {
    const driver = new Driver(flow)
    driver.startDm()
    driver.tick(POSTBACK_MINUTES)
    const result = driver.send({ type: 'timeout' })
    expect(result.run.status).toBe('expired')
    expect(result.run.wait).toBeNull()
    expect(driver.send({ type: 'timeout' }).ignored).toBe(true)
  })

  it('a tap reopens messaging after a comment private reply', () => {
    const driver = new Driver({
      trigger: { type: 'comment_keyword', posts: { mode: 'any' }, keywords: ['GO'], match: 'contains' },
      start: 's1',
      steps: flow.steps,
    })
    driver.startComment('c1', 'go')
    expect(driver.run.outbound).toBe('blocked')
    driver.send({ type: 'postback', stepId: 's1', buttonId: 'yes' })
    expect(driver.effects).toEqual([{ type: 'send', message: { text: 'Sending!' } }])
    expect(driver.run.outbound).toBe('dm')
  })
})
