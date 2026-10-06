import { describe, expect, it } from 'vitest'
import { safeNext } from '@/lib/redirects'

describe('safeNext', () => {
  it('keeps same-origin paths', () => {
    expect(safeNext('/automations/123?tab=dm', '/home')).toBe('/automations/123?tab=dm')
  })

  it('falls back for control characters and backslash tricks that browsers normalise to another host', () => {
    for (const value of ['/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '/\\evil.com', '/%09/evil.com'.replace('%09', decodeURIComponent('%09'))]) {
      expect(safeNext(value, '/home')).toBe('/home')
    }
    expect(safeNext('/home?x=1', '/x')).toBe('/home?x=1')
  })

  it('falls back for anything that could leave the site', () => {
    for (const value of ['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', '', null, undefined]) {
      expect(safeNext(value, '/home')).toBe('/home')
    }
  })
})
