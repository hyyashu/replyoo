import { describe, expect, it } from 'vitest'
import { Driver, dmFlow } from './helpers'

const link = { type: 'url' as const, label: 'Open', url: 'https://example.com/guide' }
const clickFollowUp = { afterMinutes: 90, text: 'Still want it, {{first_name|there}}?' }
const cards = [{ title: 'Guide', button: { label: 'Get it', url: 'https://example.com/guide' } }]

describe('advance: click follow-ups', () => {
  it('attaches the rendered follow-up to a link message and completes the run', () => {
    const driver = new Driver(dmFlow({ s1: { type: 'send_message', text: 'Here', buttons: [link], clickFollowUp } }))
    const result = driver.startDm()
    expect(result.effects).toEqual([
      {
        type: 'send',
        message: { text: 'Here', buttons: [link], followUp: { afterMinutes: 90, text: 'Still want it, Priya?' } },
      },
    ])
    expect(result.run.status).toBe('completed')
  })

  it('attaches it to the carousel, not to the intro', () => {
    const driver = new Driver(dmFlow({ s1: { type: 'send_products', text: 'Take a look', cards, clickFollowUp } }))
    driver.startDm()
    expect(driver.effects).toEqual([
      { type: 'send', message: { text: 'Take a look' } },
      { type: 'send', message: { text: '', cards, followUp: { afterMinutes: 90, text: 'Still want it, Priya?' } } },
    ])
  })

  it('attaches nothing when the step has no follow-up', () => {
    const driver = new Driver(dmFlow({ s1: { type: 'send_message', text: 'Here', buttons: [link] } }))
    driver.startDm()
    expect(driver.effects).toEqual([{ type: 'send', message: { text: 'Here', buttons: [link] } }])
  })
})
