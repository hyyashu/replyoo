import { describe, expect, it } from 'vitest'
import { parseAnswer } from '../src'

describe('parseAnswer email', () => {
  it.each([
    ['priya@gmail.com', 'priya@gmail.com'],
    ["it's PRIYA@Gmail.com thanks", 'priya@gmail.com'],
    ['mail me at a.b+c@sub.example.co.in.', 'a.b+c@sub.example.co.in'],
  ])('extracts %s', (input, expected) => {
    expect(parseAnswer(input, 'email')).toBe(expected)
  })

  it.each(['idk', 'priya@gmail', '@gmail.com', ''])('rejects %j', (input) => {
    expect(parseAnswer(input, 'email')).toBeNull()
  })
})

describe('parseAnswer phone', () => {
  it.each([
    ['+91 98765-43210', '+919876543210'],
    ['(555) 123-4567', '5551234567'],
    ['my number is 98765 43210, thanks', '9876543210'],
  ])('extracts %s', (input, expected) => {
    expect(parseAnswer(input, 'phone')).toBe(expected)
  })

  it.each(['123', 'no phone', '12345678901234567'])('rejects %j', (input) => {
    expect(parseAnswer(input, 'phone')).toBeNull()
  })
})

describe('parseAnswer text', () => {
  it('trims and accepts non-empty text up to 500 chars', () => {
    expect(parseAnswer('  Pune  ', 'text')).toBe('Pune')
    expect(parseAnswer('   ', 'text')).toBeNull()
    expect(parseAnswer('x'.repeat(501), 'text')).toBeNull()
  })
})
