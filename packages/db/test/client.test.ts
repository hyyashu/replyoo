import { describe, expect, it } from 'vitest'
import { parsePoolMax } from '../src/client'

describe('parsePoolMax', () => {
  it('defaults to 10 when unset or empty', () => {
    expect(parsePoolMax(undefined)).toBe(10)
    expect(parsePoolMax('')).toBe(10)
    expect(parsePoolMax('  ')).toBe(10)
  })

  it('accepts a positive integer', () => {
    expect(parsePoolMax('1')).toBe(1)
    expect(parsePoolMax(' 25 ')).toBe(25)
  })

  it('rejects anything else', () => {
    for (const bad of ['0', '-1', '2.5', 'ten', '1e3', '0x10', '99999999999999999999']) {
      expect(() => parsePoolMax(bad), bad).toThrow('DATABASE_POOL_MAX must be a positive integer')
    }
  })
})
