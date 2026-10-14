import { describe, expect, it } from 'vitest'
import { SECTION_KEYS, SECTIONS } from '@/lib/content/sections'
import { TOOL_PAGES, getToolPage } from '@/lib/content/tools'
import { cleanHandle, dmLink } from '@/lib/tools/dm-link'
import { REPLY_SCENARIO_KEYS, REPLY_SCENARIOS, REPLY_TONES, generateReplies, renderReply } from '@/lib/tools/dm-replies'
import { engagementRate } from '@/lib/tools/engagement'
import { qrSvg } from '@/lib/tools/qr'
import { TEXT_LIMITS, countCharacters, textStats } from '@/lib/tools/text-limits'
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

describe('qrSvg', () => {
  it('draws a version 2 code for a short DM link, quiet zone included', () => {
    // 25 modules for version 2, plus 4 blank modules on each side.
    const svg = qrSvg('https://ig.me/m/maya.makes')
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 33 33"/)
    expect(svg).toContain('<rect width="33" height="33" fill="#fff"/>')
    // The top-left finder pattern starts right after the quiet zone; nothing is drawn inside the zone.
    expect(svg).toContain('M4 4h1v1h-1z')
    expect(svg).not.toMatch(/M[0-3] \d+h|M\d+ [0-3]h/)
  })

  it('is deterministic and changes with the link', () => {
    expect(qrSvg('https://ig.me/m/a')).toBe(qrSvg('https://ig.me/m/a'))
    expect(qrSvg('https://ig.me/m/a')).not.toBe(qrSvg('https://ig.me/m/b'))
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

describe('DM reply templates', () => {
  const filled = { name: 'Sam', offer: 'the 5-day meal plan', price: '$29', link: 'https://example.com/plan' }

  it('fill the fields and mark the missing ones', () => {
    expect(renderReply('Hi {name}! {offer} is {price}: {link}', filled)).toBe('Hi Sam! The 5-day meal plan is $29: https://example.com/plan')
    expect(renderReply('Hi {name}! {offer} is {price}: {link}', {})).toBe('Hi! [your offer] is [price]: [your link]')
  })

  it('capitalise a value that opens a sentence, but not links', () => {
    expect(renderReply('Hey {name}! {offer} is {price} 👉 {link}', { offer: 'the plan', price: '$29', link: 'example.com' })).toBe('Hey! The plan is $29 👉 example.com')
    expect(renderReply('Thanks 😊 {offer} is ready. {link}', { offer: 'the plan', link: 'example.com' })).toBe('Thanks 😊 The plan is ready. example.com')
    expect(renderReply('Link to {offer}: {link}', { offer: 'the plan', link: 'x' })).toBe('Link to the plan: x')
  })

  it('leave out an empty name cleanly', () => {
    expect(renderReply('Thank you, {name}, I really appreciate it.', { name: ' ' })).toBe('Thank you, I really appreciate it.')
    expect(renderReply('Here you go {name} 👉 {link}', { link: 'x' })).toBe('Here you go 👉 x')
    expect(renderReply('So sorry, {name}. What happened?', {})).toBe('So sorry. What happened?')
  })

  it('only use the fields their scenario asks for, and read well with or without a name', () => {
    for (const key of REPLY_SCENARIO_KEYS) {
      const scenario = REPLY_SCENARIOS[key]
      for (const { value: tone } of REPLY_TONES) {
        expect(scenario.replies[tone].length, `${key}/${tone}`).toBeGreaterThan(0)
        for (const template of scenario.replies[tone]) {
          for (const [, field] of template.matchAll(/\{(\w+)\}/g)) expect(scenario.fields, `${key}/${tone}: ${template}`).toContain(field)
        }
        const values = Object.fromEntries(scenario.fields.map((f) => [f, filled[f]]))
        for (const reply of [...generateReplies(key, tone, values), ...generateReplies(key, tone, { ...values, name: '' })]) {
          expect(reply, reply).not.toMatch(/[{}]|\[|  |,,|, ,| [!.?,]|^[,!.?]/)
          expect(countCharacters(reply)).toBeLessThanOrEqual(TEXT_LIMITS.dm.max)
        }
      }
    }
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

  it('are only linked from feature, use-case and audience pages by real slugs', () => {
    for (const section of SECTION_KEYS) {
      for (const page of SECTIONS[section].pages) {
        for (const slug of page.tools ?? []) expect(getToolPage(slug), `${section}/${page.slug} → ${slug}`).toBeDefined()
      }
    }
  })
})
