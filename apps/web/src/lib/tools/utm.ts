export const UTM_FIELDS = ['source', 'medium', 'campaign', 'content', 'term'] as const
export type UtmField = (typeof UTM_FIELDS)[number]
export type UtmParams = Partial<Record<UtmField, string>>

export type UtmResult = { ok: true; url: string } | { ok: false; error: 'url' | 'source' }

/** Adds utm_* parameters to a URL. Existing utm_* values are replaced; other query parameters and the #fragment are kept. */
export function buildUtmUrl(input: string, params: UtmParams): UtmResult {
  let url: URL
  try {
    const trimmed = input.trim()
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return { ok: false, error: 'url' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, error: 'url' }
  if (!params.source?.trim()) return { ok: false, error: 'source' }
  for (const field of UTM_FIELDS) {
    const value = params[field]?.trim()
    if (value) url.searchParams.set(`utm_${field}`, value)
    else url.searchParams.delete(`utm_${field}`)
  }
  return { ok: true, url: url.toString() }
}
