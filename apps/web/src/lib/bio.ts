/** Pure helpers for the bio page; safe to import from client components. */

export const BIO_MAX = 160
export const NAME_MAX = 60
export const LABEL_MAX = 80
export const URL_MAX = 2048
export const SLUG_MAX = 30
export const MAX_BLOCKS = 50

export const THEME_IDS = ['modern', 'light', 'dark'] as const
export type BioThemeId = (typeof THEME_IDS)[number]

export function isThemeId(value: string): value is BioThemeId {
  return (THEME_IDS as readonly string[]).includes(value)
}

/** Each theme is a set of CSS variables; the page and the editor preview both read them. */
export const BIO_THEMES: Record<BioThemeId, { label: string; blurb: string; vars: Record<string, string> }> = {
  modern: {
    label: 'Modern',
    blurb: 'Warm gradient with bold buttons',
    vars: {
      '--bio-bg': 'linear-gradient(160deg, #ff7a45 0%, #ff4f1f 45%, #6b4bff 100%)',
      '--bio-text': '#ffffff',
      '--bio-muted': 'rgba(255,255,255,0.82)',
      '--bio-card-bg': 'rgba(255,255,255,0.95)',
      '--bio-card-text': '#151310',
      '--bio-card-border': 'transparent',
      '--bio-avatar-bg': '#151310',
      '--bio-avatar-text': '#d8f25a',
    },
  },
  light: {
    label: 'Light',
    blurb: 'Clean white with soft outlines',
    vars: {
      '--bio-bg': '#f5f1ea',
      '--bio-text': '#151310',
      '--bio-muted': '#5f584f',
      '--bio-card-bg': '#ffffff',
      '--bio-card-text': '#151310',
      '--bio-card-border': '#e2dbcf',
      '--bio-avatar-bg': '#151310',
      '--bio-avatar-text': '#d8f25a',
    },
  },
  dark: {
    label: 'Dark',
    blurb: 'Near-black with lime accents',
    vars: {
      '--bio-bg': '#151310',
      '--bio-text': '#ffffff',
      '--bio-muted': 'rgba(255,255,255,0.65)',
      '--bio-card-bg': '#26221d',
      '--bio-card-text': '#ffffff',
      '--bio-card-border': '#3a352e',
      '--bio-avatar-bg': '#d8f25a',
      '--bio-avatar-text': '#151310',
    },
  },
}

export function themeVars(theme: string): Record<string, string> {
  return BIO_THEMES[isThemeId(theme) ? theme : 'modern'].vars
}

/** Lowercase url-safe slug of at most SLUG_MAX characters, never empty and at least 3 long. */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '')
  if (!slug) return 'me'
  return slug.length < 3 ? `${slug}-page`.slice(0, SLUG_MAX) : slug
}

/** Attempt 0 is the base slug; later attempts append -2, -3 ... and finally a random suffix. */
export function slugCandidate(base: string, attempt: number, random: () => string = () => Math.random().toString(36).slice(2, 6)): string {
  if (attempt <= 0) return base
  const suffix = attempt <= 20 ? String(attempt + 1) : random().padEnd(4, '0')
  return `${base.slice(0, SLUG_MAX - suffix.length - 1).replace(/-+$/g, '')}-${suffix}`
}

/**
 * Accepts what people paste ("example.com/x", "https://…") and returns a normalised http(s) URL,
 * or null for anything else (javascript:, data:, mailto:, credentials in the URL, hosts without a dot).
 */
export function normalizeHttpUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed || trimmed.length > URL_MAX || /\s/.test(trimmed)) return null
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password || !url.hostname.includes('.')) return null
  return url.href
}

/** Render-time guard for stored URLs. */
export function isSafeHttpUrl(value: string | undefined | null): value is string {
  if (!value) return false
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** Crawlers and link-preview fetchers shouldn't count as visitors. */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true
  return /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|curl|wget|headless|monitor/i.test(userAgent)
}

/** Share of page views that led to a click, as a whole percent capped at 100. */
export function clickRate(clicks: number, views: number): number {
  if (views <= 0) return 0
  return Math.min(100, Math.round((clicks / views) * 100))
}
