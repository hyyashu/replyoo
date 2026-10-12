import { generateLinkCode, linkClicks, trackedLinks } from '@replyooo/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { GET, HEAD } from '@/app/l/[code]/route'
import { db } from '@/lib/db'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

async function link(url: string) {
  const code = generateLinkCode()
  const [row] = await db().insert(trackedLinks).values({ code, position: 0, url }).returning()
  return { code, id: row!.id }
}

const request = (code: string, headers: Record<string, string> = {}, method = 'GET') =>
  new Request(`http://localhost/l/${code}`, { method, headers })
const params = (code: string) => ({ params: Promise.resolve({ code }) })
const clicks = async (linkId: string) => (await db().select().from(linkClicks).where(eq(linkClicks.linkId, linkId))).length

describe('GET /l/[code]', () => {
  it('redirects a visitor to the destination and counts the click', async () => {
    const { code, id } = await link('https://example.com/guide')
    const response = await GET(request(code, { 'user-agent': IPHONE }), params(code))
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://example.com/guide')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await clicks(id)).toBe(1)
  })

  it('counts every visit, so repeat taps are visible as clicks', async () => {
    const { code, id } = await link('https://example.com/guide')
    await GET(request(code, { 'user-agent': IPHONE }), params(code))
    await GET(request(code, { 'user-agent': IPHONE }), params(code))
    expect(await clicks(id)).toBe(2)
  })

  it.each([
    ['a link preview bot', { 'user-agent': 'facebookexternalhit/1.1' }],
    ['a crawler', { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }],
    ['a request with no user agent', {}],
  ])('redirects %s without counting a click', async (_name, headers) => {
    const { code, id } = await link('https://example.com/guide')
    const response = await GET(request(code, headers), params(code))
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://example.com/guide')
    expect(await clicks(id)).toBe(0)
  })

  it('answers HEAD requests without counting a click', async () => {
    const { code, id } = await link('https://example.com/guide')
    const response = await HEAD(request(code, { 'user-agent': IPHONE }, 'HEAD'), params(code))
    expect(response.status).toBe(302)
    expect(await clicks(id)).toBe(0)
  })

  it.each(['', 'abc', 'abcdefghi', 'abcd-fgh', '../../x'])('returns 404 for the malformed code %j', async (code) => {
    const response = await GET(request(code || 'x', { 'user-agent': IPHONE }), params(code))
    expect(response.status).toBe(404)
  })

  it('returns 404 for a well-formed code that does not exist', async () => {
    const response = await GET(request('Zz9Zz9Zz', { 'user-agent': IPHONE }), params('Zz9Zz9Zz'))
    expect(response.status).toBe(404)
  })

  it.each(['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com/a', 'not a url'])(
    'refuses to redirect to the stored destination %j',
    async (url) => {
      const { code, id } = await link(url)
      const response = await GET(request(code, { 'user-agent': IPHONE }), params(code))
      expect(response.status).toBe(404)
      expect(response.headers.get('location')).toBeNull()
      expect(await clicks(id)).toBe(0)
    },
  )
})
