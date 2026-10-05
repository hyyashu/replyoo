import { describe, expect, it } from 'vitest'
import { PlatformSchema } from '../src'

describe('PlatformSchema', () => {
  it('accepts instagram and facebook', () => {
    expect(PlatformSchema.parse('instagram')).toBe('instagram')
    expect(PlatformSchema.parse('facebook')).toBe('facebook')
  })

  it('rejects other platforms', () => {
    expect(PlatformSchema.safeParse('whatsapp').success).toBe(false)
  })
})
