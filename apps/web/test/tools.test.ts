import { describe, expect, it } from 'vitest'
import { TOOL_PAGES, getToolPage } from '@/lib/content/tools'
import { cleanHandle, dmLink } from '@/lib/tools/dm-link'
import { engagementRate } from '@/lib/tools/engagement'
import { countCharacters, textStats } from '@/lib/tools/text-limits'
import { buildUtmUrl } from '@/lib/tools/utm'

describe('dmLink', () => {
  it('builds ig.me and m.me links', () => {
    expect(dmLink('instagram', 'maya.makes')).toBe('https://ig.me/m/maya.makes')
    expect(dmLink('facebook', 'mayamakes')).toBe('https://m.me/mayamakes')
  })

  it('accepts a pasted @handle or profile URL', () => {
    expect(cleanHandle('  @maya.makes ')).toBe('maya.makes')
    expect(cleanHandle('https://www.instagram.com/maya.makes/?hl=en')).toBe('maya.makes')
    expect(cleanHandle('instagram.com/maya_makes/')).toBe('maya_makes')
    expect(cleanHandle('https://ig.me/m/maya.makes')).toBe('maya.makes')
    expect(cleanHandle('https://www.facebook.com/mayamakes')).toBe('mayamakes')
  })

  it('rejects handles that cannot exist', () => {
    expect(dmLink('instagram', '')).toBeNull()
    expect(dmLink('instagram', 'maya makes')).toBeNull()
    expect(dmLink('instagram', 'a'.repeat(31))).toBeNull()
    expect(dmLink('facebook', 'abc')).toBeNull()
    expect(dmLink('facebook', 'maya_makes')).toBeNull()
  })
})

describe('buildUtmUrl', () => {
  it('adds the filled fields and adds https when missing', () => {
    expect(buildUtmUrl('example.com/guide', { source: 'instagram', medium: 'dm', campaign: 'guide launch' })).toEqual({
      ok: true,
      url: 'https://example.com/guide?utm_source=instagram&utm_medium=dm&utm_campaign=guide+launch',
    })
  })

  it('keeps other parameters and the fragment, and replaces old utm values', () => {
    const result = buildUtmUrl('https://example.com/p?id=7&utm_source=old&utm_term=x#buy', { source: 'instagram' })
    expect(result).toEqual({ ok: true, url: 'https://example.com/p?id=7&utm_source=instagram#buy' })
  })

  it('needs a web URL and a source', () => {
    expect(buildUtmUrl('', { source: 'instagram' })).toEqual({ ok: false, error: 'url' })
    expect(buildUtmUrl('javascript:alert(1)', { source: 'instagram' })).toEqual({ ok: false, error: 'url' })
    expect(buildUtmUrl('example.com', { source: '  ' })).toEqual({ ok: false, error: 'source' })
  })
})

describe('engagementRate', () => {
  it('averages interactions per post over followers', () => {
    const result = engagementRate({
      followers: 2000,
      posts: [
        { likes: 100, comments: 20 },
        { likes: 50, comments: 5, saves: 10, shares: 15 },
      ],
    })
    expect(result).toEqual({ rate: 0.05, averageInteractions: 100 })
  })

  it('ignores negative or missing numbers and needs followers and posts', () => {
    expect(engagementRate({ followers: 100, posts: [{ likes: -5, comments: Number.NaN, saves: 10 }] })).toEqual({ rate: 0.1, averageInteractions: 10 })
    expect(engagementRate({ followers: 0, posts: [{ likes: 1, comments: 1 }] })).toBeNull()
    expect(engagementRate({ followers: 100, posts: [] })).toBeNull()
  })
})

describe('textStats', () => {
  it('counts an emoji or accented letter as one character', () => {
    expect(countCharacters('👋🏽 café')).toBe(6)
    expect(countCharacters('👨‍👩‍👧')).toBe(1)
  })

  it('counts words, hashtags, mentions and lines', () => {
    expect(textStats('New guide out 🎉\nComment GUIDE #coaching #mindset @maya.makes\nemail@x.com')).toEqual({
      characters: 72,
      words: 10,
      hashtags: 2,
      mentions: 1,
      lines: 3,
    })
    expect(textStats('')).toEqual({ characters: 0, words: 0, hashtags: 0, mentions: 0, lines: 0 })
  })
})

describe('tool pages', () => {
  it('have unique slugs, real related pages and a valid date', () => {
    expect(new Set(TOOL_PAGES.map((p) => p.slug)).size).toBe(TOOL_PAGES.length)
    for (const page of TOOL_PAGES) {
      for (const slug of page.related) expect(getToolPage(slug), `${page.slug} → ${slug}`).toBeDefined()
      expect(page.related).not.toContain(page.slug)
      expect(page.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})
