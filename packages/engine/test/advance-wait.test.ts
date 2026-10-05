import { describe, expect, it } from 'vitest'
import { Driver, T0, addMinutes, dmFlow } from './helpers'

describe('delay step', () => {
  const flow = dmFlow({
    s1: { type: 'delay', minutes: 10, next: 's2' },
    s2: { type: 'send_message', text: 'later' },
  })

  it('waits for the configured minutes', () => {
    const driver = new Driver(flow)
    const result = driver.startDm()
    expect(result.effects).toEqual([{ type: 'schedule_timeout', at: addMinutes(T0, 10) }])
    expect(result.run).toMatchObject({ status: 'waiting', wait: { kind: 'delay' } })
  })

  it('early delay timeout is ignored', () => {
    const driver = new Driver(flow)
    driver.startDm()
    driver.tick(9)
    expect(driver.send({ type: 'timeout' }).ignored).toBe(true)
  })

  it('continues after the delay', () => {
    const driver = new Driver(flow)
    driver.startDm()
    driver.tick(10)
    driver.send({ type: 'timeout' })
    expect(driver.sentTexts()).toEqual(['later'])
    expect(driver.run.status).toBe('completed')
  })

  it('ignores replies during a delay', () => {
    const driver = new Driver(flow)
    driver.startDm()
    expect(driver.send({ type: 'reply', text: 'hello?' }).ignored).toBe(true)
  })
})

describe('check_follow step', () => {
  const flow = dmFlow({
    s1: { type: 'check_follow', following: 'yes', notFollowing: 'no' },
    yes: { type: 'send_message', text: 'thanks for following' },
    no: { type: 'send_message', text: 'please follow' },
  })

  it('asks the worker to check and waits up to 5 minutes', () => {
    const driver = new Driver(flow)
    const result = driver.startDm()
    expect(result.effects).toEqual([
      { type: 'check_follow' },
      { type: 'schedule_timeout', at: addMinutes(T0, 5) },
    ])
    expect(result.run.wait).toEqual({ kind: 'follow_check' })
  })

  it('branches on the follow result', () => {
    const following = new Driver(flow)
    following.startDm()
    following.send({ type: 'follow_result', following: true })
    expect(following.sentTexts()).toEqual(['thanks for following'])

    const notFollowing = new Driver(flow)
    notFollowing.startDm()
    notFollowing.send({ type: 'follow_result', following: false })
    expect(notFollowing.sentTexts()).toEqual(['please follow'])
  })

  it('fails if the check never comes back', () => {
    const driver = new Driver(flow)
    driver.startDm()
    driver.tick(5)
    const result = driver.send({ type: 'timeout' })
    expect(result.run.status).toBe('failed')
    expect(result.run.error).toBe('follow_check_timeout')
  })

  it('ignores follow results when not waiting for one', () => {
    const driver = new Driver(dmFlow({ s1: { type: 'delay', minutes: 5 } }))
    driver.startDm()
    expect(driver.send({ type: 'follow_result', following: true }).ignored).toBe(true)
  })
})
