import { describe, expect, it } from 'vitest'
import { renderText } from '../src'
import { makeContact } from './helpers'

describe('renderText', () => {
  it('renders contact variables', () => {
    const contact = makeContact({ email: 'p@x.com', fields: { city: 'Pune' } })
    expect(renderText('Hi {{first_name}} ({{username}}) {{email}} {{fields.city}}', contact, {})).toBe(
      'Hi Priya (priya) p@x.com Pune',
    )
  })

  it('uses the fallback when a value is missing', () => {
    const contact = makeContact({ name: null })
    expect(renderText('Hey {{ first_name | there }}!', contact, {})).toBe('Hey there!')
  })

  it('renders an empty string for unknown or missing values without fallback', () => {
    expect(renderText('[{{phone}}][{{nope}}]', makeContact(), {})).toBe('[][]')
  })

  it('renders run vars', () => {
    expect(renderText('Code: {{vars.code}}', makeContact(), { code: 'X1' })).toBe('Code: X1')
  })
})
