export const locales = {
  en: { name: 'English', direction: 'ltr' },
  es: { name: 'Español', direction: 'ltr' },
} as const

export type Locale = keyof typeof locales
export const LOCALE_COOKIE = 'replyooo_locale'
export const DASHBOARD_HEADER = 'x-replyooo-dashboard'

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && Object.hasOwn(locales, value)
}

export function resolveLocale(input: { preferred?: string | null; cookie?: string; acceptLanguage?: string }): Locale {
  if (isLocale(input.preferred)) return input.preferred
  if (isLocale(input.cookie)) return input.cookie
  const candidates = (input.acceptLanguage ?? '').split(',').flatMap((part, index) => {
    const match = /^\s*([a-z]{2,3}(?:-[a-z0-9]{2,8})*)(?:\s*;\s*q=(0(?:\.\d{1,3})?|1(?:\.0{1,3})?))?\s*$/i.exec(part)
    if (!match) return []
    const quality = match[2] === undefined ? 1 : Number(match[2])
    const locale = match[1]!.toLowerCase().split('-')[0]
    return quality > 0 && isLocale(locale) ? [{ locale, quality, index }] : []
  })
  candidates.sort((a, b) => b.quality - a.quality || a.index - b.index)
  return candidates[0]?.locale ?? 'en'
}
