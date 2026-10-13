import type { Trigger } from '@replyooo/shared'
import { describe, expect, it } from 'vitest'
import type { CommentItem, CommentPage, PlatformAdapter } from '../src'
import { collectComments, commentTargets, gatherComments } from '../src'

const account = { externalId: 'acct', accessToken: 't' }
const NOW = new Date('2026-10-13T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

const item = (id: string, createdAt: Date, mediaId = 'm1'): CommentItem => ({
  id,
  mediaId,
  text: 'GUIDE',
  createdAt,
  authorId: `u_${id}`,
  authorUsername: null,
  authorName: null,
})

/** An adapter whose pages are given up front; the cursor is the page index. */
function pagedAdapter(pagesByMedia: Record<string, CommentItem[][]>) {
  const requests: { mediaId: string; cursor?: string; since?: Date }[] = []
  const adapter = {
    async listComments(_: unknown, mediaId: string, opts: { cursor?: string; since?: Date } = {}): Promise<CommentPage> {
      requests.push({ mediaId, ...opts })
      const pages = pagesByMedia[mediaId] ?? []
      const index = opts.cursor ? Number(opts.cursor) : 0
      const next = index + 1 < pages.length ? { next: String(index + 1) } : {}
      return { items: pages[index] ?? [], ...next }
    },
  } as unknown as Pick<PlatformAdapter, 'listComments'>
  return { adapter, requests }
}

describe('collectComments', () => {
  it('keeps comments inside the window and stops paging once a page is entirely older', async () => {
    const { adapter, requests } = pagedAdapter({
      m1: [
        [item('a', hoursAgo(1)), item('b', hoursAgo(30))],
        [item('c', hoursAgo(80)), item('d', hoursAgo(90))],
        [item('e', hoursAgo(100))],
      ],
    })
    const result = await collectComments(adapter, account, 'm1', { since: hoursAgo(48), max: 100 })
    expect(result).toEqual({ items: [item('a', hoursAgo(1)), item('b', hoursAgo(30))], capped: false })
    expect(requests).toHaveLength(2)
  })

  it('does not stop on an out-of-order page that still has in-window comments (ranked results)', async () => {
    const { adapter } = pagedAdapter({
      m1: [
        [item('old1', hoursAgo(100)), item('new1', hoursAgo(2))],
        [item('old2', hoursAgo(120)), item('new2', hoursAgo(3))],
      ],
    })
    const result = await collectComments(adapter, account, 'm1', { since: hoursAgo(48), max: 100 })
    expect(result.items.map((c) => c.id)).toEqual(['new1', 'new2'])
  })

  it('passes since to the adapter', async () => {
    const { adapter, requests } = pagedAdapter({ m1: [[item('a', hoursAgo(1))]] })
    const since = hoursAgo(24)
    await collectComments(adapter, account, 'm1', { since, max: 10 })
    expect(requests[0]?.since).toEqual(since)
  })

  it('stops at the cap and says so', async () => {
    const { adapter } = pagedAdapter({ m1: [[item('a', hoursAgo(1)), item('b', hoursAgo(2)), item('c', hoursAgo(3))]] })
    const result = await collectComments(adapter, account, 'm1', { since: hoursAgo(48), max: 2 })
    expect(result.items.map((c) => c.id)).toEqual(['a', 'b'])
    expect(result.capped).toBe(true)
  })

  it('is not capped when it ends exactly at the limit', async () => {
    const { adapter } = pagedAdapter({ m1: [[item('a', hoursAgo(1)), item('b', hoursAgo(2))]] })
    const result = await collectComments(adapter, account, 'm1', { since: hoursAgo(48), max: 2 })
    expect(result.capped).toBe(false)
  })

  it('keeps paging past an empty page that still links to a next one (authors dropped by the adapter)', async () => {
    const adapter = {
      async listComments(_: unknown, __: string, opts: { cursor?: string } = {}): Promise<CommentPage> {
        return opts.cursor ? { items: [item('a', hoursAgo(1))] } : { items: [], next: '1' }
      },
    } as unknown as Pick<PlatformAdapter, 'listComments'>
    const result = await collectComments(adapter, account, 'm1', { since: hoursAgo(48), max: 10 })
    expect(result.items.map((c) => c.id)).toEqual(['a'])
  })
})

describe('commentTargets', () => {
  const trigger = (posts: Extract<Trigger, { type: 'comment_keyword' }>['posts']): Trigger => ({
    type: 'comment_keyword',
    posts,
    keywords: [],
    match: 'contains',
  })

  it('uses the chosen posts', () => {
    expect(commentTargets(trigger({ mode: 'specific', mediaIds: ['a', 'b'] }), null, [{ id: 'z' }])).toEqual(['a', 'b'])
  })

  it('uses the pinned post for "next post", and nothing before it is pinned', () => {
    expect(commentTargets(trigger({ mode: 'next' }), 'p1', [])).toEqual(['p1'])
    expect(commentTargets(trigger({ mode: 'next' }), null, [])).toEqual([])
  })

  it('uses the recent posts for "any post"', () => {
    expect(commentTargets(trigger({ mode: 'any' }), null, [{ id: 'x' }, { id: 'y' }])).toEqual(['x', 'y'])
  })

  it('has no targets for other trigger types', () => {
    expect(commentTargets({ type: 'any_dm' }, null, [{ id: 'x' }])).toEqual([])
  })
})

describe('gatherComments', () => {
  const anyPost: Trigger = { type: 'comment_keyword', posts: { mode: 'any' }, keywords: [], match: 'contains' }

  it('reads each target post and shares one cap across them', async () => {
    const { adapter } = pagedAdapter({
      m1: [[item('a', hoursAgo(1), 'm1'), item('b', hoursAgo(2), 'm1')]],
      m2: [[item('c', hoursAgo(3), 'm2'), item('d', hoursAgo(4), 'm2')]],
    })
    const full = { ...adapter, listMedia: async () => [{ id: 'm1' }, { id: 'm2' }] } as unknown as PlatformAdapter
    const result = await gatherComments(full, account, { trigger: anyPost, pinnedMediaId: null, since: hoursAgo(48), max: 3 })
    expect(result.comments.map((c) => c.id)).toEqual(['a', 'b', 'c'])
    expect(result.capped).toBe(true)
  })

  it('does not list media when the automation names its posts', async () => {
    const { adapter } = pagedAdapter({ m9: [[item('a', hoursAgo(1), 'm9')]] })
    const full = {
      ...adapter,
      listMedia: async () => {
        throw new Error('should not list media')
      },
    } as unknown as PlatformAdapter
    const specific: Trigger = { type: 'comment_keyword', posts: { mode: 'specific', mediaIds: ['m9'] }, keywords: [], match: 'contains' }
    const result = await gatherComments(full, account, { trigger: specific, pinnedMediaId: null, since: hoursAgo(48), max: 10 })
    expect(result.comments.map((c) => c.id)).toEqual(['a'])
    expect(result.capped).toBe(false)
  })
})
