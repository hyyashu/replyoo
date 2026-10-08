import { describe, expect, it } from 'vitest'
import { parseAnswer, renderText } from '../src'
import { makeContact } from './helpers'

describe('renderText edge', () => {
  it('fallbacks, whitespace in braces and unknown keys', () => {
    const contact = makeContact({ name: null, username: null })
    expect(renderText('Hi {{ first_name | there }}!', contact, {})).toBe('Hi there!')
    expect(renderText('[{{unknown}}]', contact, {})).toBe('[]')
    expect(renderText('[{{vars.missing|x}}]', contact, {})).toBe('[x]')
  })

  it('uppercase placeholders are left untouched', () => {
    expect(renderText('{{FIRST_NAME}}', makeContact(), {})).toBe('{{FIRST_NAME}}')
  })

  it('first_name of a blank name falls back', () => {
    expect(renderText('{{first_name|friend}}', makeContact({ name: '   ' }), {})).toBe('friend')
    expect(renderText('{{first_name}}', makeContact({ name: '  Priya   Sharma ' }), {})).toBe('Priya')
  })

  it('does not re-render placeholders inside values or interpret $ patterns', () => {
    const contact = makeContact({ name: '{{email}} $& $1', email: 'secret@x.co' })
    expect(renderText('{{name}}', contact, {})).toBe('{{email}} $& $1')
  })

  // BUG: lookup() indexes plain objects, so inherited members leak ("function Object() { [native code] }").
  it('BUG: does not leak Object.prototype members through fields./vars.', () => {
    const contact = makeContact()
    expect(renderText('[{{fields.constructor|none}}]', contact, {})).toBe('[none]')
    expect(renderText('[{{vars.constructor|none}}]', contact, {})).toBe('[none]')
  })
})

describe('parseAnswer edge', () => {
  it('extracts an email from surrounding text and lowercases it', () => {
    expect(parseAnswer('sure: Priya.S+1@Mail.Example.COM.', 'email')).toBe('priya.s+1@mail.example.com')
  })

  it('straight quotes and angle brackets are excluded from the email', () => {
    expect(parseAnswer('"priya@gmail.com"', 'email')).toBe('priya@gmail.com')
    expect(parseAnswer('<priya@gmail.com>', 'email')).toBe('priya@gmail.com')
  })

  // BUG: iOS/Android keyboards insert smart quotes; the leading quote is saved as part of the email.
  it('BUG: does not include smart quotes in the email', () => {
    expect(parseAnswer('my email is “priya@gmail.com”', 'email')).toBe('priya@gmail.com')
  })

  it('BUG: does not include square brackets in the email', () => {
    expect(parseAnswer('[priya@gmail.com]', 'email')).toBe('priya@gmail.com')
  })

  // Design note: "*" is a legal local-part character (RFC 5322 atext), so this is kept as-is.
  it('asterisks around the email are kept in the local part', () => {
    expect(parseAnswer('*priya@gmail.com*', 'email')).toBe('*priya@gmail.com')
  })

  it('rejects non-emails', () => {
    expect(parseAnswer('priya at gmail dot com', 'email')).toBeNull()
    expect(parseAnswer('priya@gmail', 'email')).toBeNull()
    expect(parseAnswer('@@', 'email')).toBeNull()
  })

  it('phone: accepts formatted numbers, rejects too short/long', () => {
    expect(parseAnswer('+1 (555) 123-4567', 'phone')).toBe('+15551234567')
    expect(parseAnswer('12345', 'phone')).toBeNull()
    expect(parseAnswer('1234567890123456', 'phone')).toBeNull()
  })

  // Design note (documents current behaviour): phone validation is deliberately lenient, so any
  // 7-15 digit run after stripping separators is accepted, including dates and digits in usernames.
  it('phone: lenient — a date or digits inside an email are accepted as a phone', () => {
    expect(parseAnswer('2026-10-08', 'phone')).toBe('20261008')
    expect(parseAnswer('john1234567@x.com', 'phone')).toBe('1234567')
  })

  it('text: trims and caps at 500', () => {
    expect(parseAnswer('   ', 'text')).toBeNull()
    expect(parseAnswer(` ${'a'.repeat(500)} `, 'text')).toBe('a'.repeat(500))
    expect(parseAnswer('a'.repeat(501), 'text')).toBeNull()
  })
})
