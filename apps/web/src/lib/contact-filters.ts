import type { ContactFilters } from './data/types'

type Params = Record<string, string | string[] | undefined> | URLSearchParams

export function parseContactFilters(params: Params): ContactFilters {
  const one = (key: string) => {
    const value = params instanceof URLSearchParams ? params.get(key) : params[key]
    return typeof value === 'string' && value !== '' ? value : undefined
  }
  const has = one('has')
  const rel = one('rel')
  return {
    q: one('q'),
    tag: one('tag'),
    has: has === 'email' || has === 'phone' || has === 'lead' ? has : undefined,
    rel: rel === 'follows_you' || rel === 'mutual' ? rel : undefined,
  }
}
