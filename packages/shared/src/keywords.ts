import type { KeywordMatch } from './flow'

export function normalizeText(input: string): string {
  return input
    .normalize('NFKC')
    // Emoji variation selectors: "❤" and "❤️" are the same thing to the person typing.
    .replace(/[\uFE0E\uFE0F]/g, '')
    .toLowerCase()
    .replace(/\p{P}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const hasWordCharacters = (value: string) => /[\p{L}\p{N}]/u.test(value)

export function matchesKeyword(text: string, keyword: string, match: KeywordMatch): boolean {
  const normalizedText = normalizeText(text)
  const normalizedKeyword = normalizeText(keyword)
  if (normalizedKeyword.length === 0) return false
  if (match === 'exact') return normalizedText === normalizedKeyword
  if (!hasWordCharacters(normalizedKeyword)) return normalizedText.includes(normalizedKeyword)
  return ` ${normalizedText} `.includes(` ${normalizedKeyword} `)
}

export function matchesAnyKeyword(
  text: string,
  keywords: readonly string[],
  match: KeywordMatch,
): boolean {
  return keywords.some((keyword) => matchesKeyword(text, keyword, match))
}
