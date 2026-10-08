import { describe, expect, it } from 'vitest'
import { matchesAnyKeyword, matchesKeyword, normalizeText } from '../src'

describe('normalizeText', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalizeText('  What is the PRICE?!\n\nPlease ')).toBe('what is the price please')
  })
})

describe('matchesKeyword contains', () => {
  it('matches a keyword as a whole word regardless of case and punctuation', () => {
    expect(matchesKeyword('what is the price?', 'PRICE', 'contains')).toBe(true)
    expect(matchesKeyword('@acme PRICE!!', 'price', 'contains')).toBe(true)
  })

  it('does not match a keyword inside a longer word', () => {
    expect(matchesKeyword('what are your prices', 'price', 'contains')).toBe(false)
  })

  it('matches multi-word phrases', () => {
    expect(matchesKeyword('Send me the FREE guide pls', 'free guide', 'contains')).toBe(true)
  })

  it('matches emoji keywords as substrings', () => {
    expect(matchesKeyword('love it 🔥🔥', '🔥', 'contains')).toBe(true)
    expect(matchesKeyword('love it', '🔥', 'contains')).toBe(false)
  })

  it('matches non-Latin scripts', () => {
    expect(matchesKeyword('कीमत?', 'कीमत', 'contains')).toBe(true)
  })

  it('never matches an empty keyword', () => {
    expect(matchesKeyword('anything', '  ', 'contains')).toBe(false)
    expect(matchesKeyword('anything', '?!', 'contains')).toBe(false)
  })
})

describe('matchesKeyword exact', () => {
  it('matches only when the whole message equals the keyword', () => {
    expect(matchesKeyword('Price!', 'price', 'exact')).toBe(true)
    expect(matchesKeyword('price please', 'price', 'exact')).toBe(false)
  })
})

describe('matchesAnyKeyword', () => {
  it('returns true when any keyword matches', () => {
    expect(matchesAnyKeyword('give me the LINK', ['guide', 'link'], 'contains')).toBe(true)
    expect(matchesAnyKeyword('hello', ['guide', 'link'], 'contains')).toBe(false)
  })
})

describe('capitalisation never matters', () => {
  const spellings = ['link', 'LINK', 'Link', 'lInK']

  it.each(spellings)('keyword "%s" matches every spelling in the text, contains and exact', (keyword) => {
    for (const text of spellings) {
      expect(matchesKeyword(text, keyword, 'exact')).toBe(true)
      expect(matchesKeyword(`send me the ${text}!`, keyword, 'contains')).toBe(true)
    }
  })

  it('still respects word boundaries after lowercasing', () => {
    expect(matchesKeyword('LINKEDIN', 'link', 'contains')).toBe(false)
  })
})
