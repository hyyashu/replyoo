import { getTemplate } from '@replyooo/shared'
import type { FlowTemplate } from '@replyooo/shared'
import { describe, expect, it } from 'vitest'
import { Driver, makeContact } from './helpers'

const template = (key: string): FlowTemplate => {
  const found = getTemplate(key)
  if (!found) throw new Error(`missing template ${key}`)
  return found
}

describe('template: email_list', () => {
  it('collects an email after one invalid try, delivers and tags', () => {
    const driver = new Driver(template('email_list').flow)

    const start = driver.startComment('c1', 'GUIDE')
    expect(start.effects.map((e) => e.type)).toEqual(['comment_reply', 'private_reply', 'schedule_timeout'])

    driver.send({ type: 'postback', stepId: 'opener', buttonId: 'yes' })
    expect(driver.sentTexts()).toHaveLength(1)
    expect(driver.run.wait).toEqual({ kind: 'reply', attempts: 0 })

    driver.send({ type: 'reply', text: 'idk' })
    expect(driver.run.wait).toEqual({ kind: 'reply', attempts: 1 })

    driver.send({ type: 'reply', text: 'ok fine priya@gmail.com' })
    expect(driver.contact.email).toBe('priya@gmail.com')
    expect(driver.contact.tags).toContain('email-lead')
    expect(driver.run.status).toBe('completed')
  })

  it('skips the question when the email is already known', () => {
    const driver = new Driver(template('email_list').flow, makeContact({ email: 'known@x.com' }))
    driver.startComment()
    driver.send({ type: 'postback', stepId: 'opener', buttonId: 'yes' })
    expect(driver.effects.some((e) => e.type === 'schedule_timeout')).toBe(false)
    expect(driver.run.status).toBe('completed')
  })
})

describe('template: follow_gate', () => {
  it('loops until the person follows, then delivers', () => {
    const driver = new Driver(template('follow_gate').flow)
    driver.startComment('c1', 'FREEBIE')
    driver.send({ type: 'postback', stepId: 'opener', buttonId: 'want' })
    expect(driver.effects[0]).toEqual({ type: 'check_follow' })

    driver.send({ type: 'follow_result', following: false })
    expect(driver.run.currentStepId).toBe('ask_follow')

    driver.send({ type: 'postback', stepId: 'ask_follow', buttonId: 'followed' })
    expect(driver.effects[0]).toEqual({ type: 'check_follow' })

    driver.send({ type: 'follow_result', following: true })
    expect(driver.run.status).toBe('completed')
    const deliver = driver.effects.find((e) => e.type === 'send')
    expect(deliver?.type === 'send' && deliver.message.buttons?.[0]?.type).toBe('url')
  })
})

describe('template: phone_numbers', () => {
  it('saves the phone number and tags the lead', () => {
    const driver = new Driver(template('phone_numbers').flow)
    driver.startComment('c1', 'CALL')
    driver.send({ type: 'postback', stepId: 'opener', buttonId: 'yes' })
    driver.send({ type: 'reply', text: '+91 98765 43210' })
    expect(driver.contact.phone).toBe('+919876543210')
    expect(driver.contact.tags).toContain('phone-lead')
    expect(driver.run.status).toBe('completed')
  })
})

describe('template: comment_to_dm', () => {
  it('sends the link after the tap', () => {
    const driver = new Driver(template('comment_to_dm').flow)
    driver.startComment('c1', 'LINK')
    driver.send({ type: 'postback', stepId: 'opener', buttonId: 'get' })
    expect(driver.run.status).toBe('completed')
    expect(driver.effects).toHaveLength(1)
  })
})

describe('template: conversation_starters', () => {
  it('answers each starter question', () => {
    const flow = template('conversation_starters').flow
    if (flow.trigger.type !== 'ice_breaker') throw new Error('expected ice breaker')
    flow.trigger.items.forEach((_item, itemIndex) => {
      const driver = new Driver(flow)
      driver.send({ type: 'start', trigger: { kind: 'ice_breaker', itemIndex } })
      expect(driver.sentTexts()).toHaveLength(1)
      expect(driver.run.status).toBe('completed')
    })
  })
})

describe('templates: dm_keyword and story_replies', () => {
  it('reply once and complete', () => {
    for (const key of ['dm_keyword', 'story_replies']) {
      const driver = new Driver(template(key).flow)
      driver.startDm('PRICE')
      expect(driver.sentTexts()).toHaveLength(1)
      expect(driver.run.status).toBe('completed')
    }
  })
})
