import { describe, expect, it } from 'vitest'
import { clickRate, isBotUserAgent, isSafeHttpUrl, normalizeHttpUrl, slugCandidate, slugify } from '@/lib/bio'

describe('slugify', () => {
  it('lowercases, strips accents and punctuation', () => {
    expect(slugify('Café Del_Mar!')).toBe('cafe-del-mar')
    expect(slugify('sam.eats')).toBe('sam-eats')
  })
  it('never returns empty or too short', () => {
    expect(slugify('!!!')).toBe('me')
    expect(slugify('ab')).toBe('ab-page')
  })
  it('caps the length', () => {
    expect(slugify('a'.repeat(80)).length).toBe(30)
  })
})

describe('slugCandidate', () => {
  it('uses numeric suffixes then a random one, within the limit', () => {
    expect(slugCandidate('sam', 0)).toBe('sam')
    expect(slugCandidate('sam', 1)).toBe('sam-2')
    expect(slugCandidate('sam', 25, () => 'abcd')).toBe('sam-abcd')
    expect(slugCandidate('a'.repeat(30), 3).length).toBeLessThanOrEqual(30)
  })
})

describe('normalizeHttpUrl', () => {
  it('accepts http(s) and bare domains', () => {
    expect(normalizeHttpUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(normalizeHttpUrl(' example.com ')).toBe('https://example.com/')
  })
  it('rejects other schemes and tricks', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'mailto:a@b.co', 'ftp://x.com', 'localhost', 'a b.com', '']) {
      expect(normalizeHttpUrl(bad)).toBeNull()
    }
  })
})

describe('isSafeHttpUrl', () => {
  it('only allows http(s)', () => {
    expect(isSafeHttpUrl('https://a.co')).toBe(true)
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeHttpUrl('')).toBe(false)
  })
})

describe('bio stats helpers', () => {
  it('rounds click rate and caps it at 100', () => {
    expect(clickRate(0, 0)).toBe(0)
    expect(clickRate(1, 3)).toBe(33)
    expect(clickRate(9, 3)).toBe(100)
  })

  it('treats crawlers, previews and empty agents as bots', () => {
    expect(isBotUserAgent(null)).toBe(true)
    expect(isBotUserAgent('facebookexternalhit/1.1')).toBe(true)
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true)
    expect(isBotUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Safari/604.1')).toBe(false)
  })
})
