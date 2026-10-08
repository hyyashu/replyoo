import { describe, expect, it } from 'vitest'
import { normalizeFacebookWebhook, normalizeInstagramWebhook } from '../src'
import { FB_PAGE, IG_ACCOUNT, T } from './fixtures'

const igMessaging = (...items: Record<string, unknown>[]) => ({
  object: 'instagram',
  entry: [{ id: IG_ACCOUNT, time: T, messaging: items.map((item) => ({ recipient: { id: IG_ACCOUNT }, timestamp: T, ...item })) }],
})
const igComment = (value: unknown, time: number = T / 1000) => ({
  object: 'instagram',
  entry: [{ id: IG_ACCOUNT, time, changes: [{ field: 'comments', value }] }],
})
const fbFeed = (value: Record<string, unknown>) => ({
  object: 'page',
  entry: [{ id: FB_PAGE, time: T / 1000, changes: [{ field: 'feed', value }] }],
})
const fbComment = (overrides: Record<string, unknown> = {}) =>
  fbFeed({
    item: 'comment',
    verb: 'add',
    comment_id: 'pc1',
    post_id: `${FB_PAGE}_post1`,
    message: 'GUIDE',
    from: { id: 'psid_1', name: 'Priya' },
    created_time: T / 1000,
    ...overrides,
  })

describe('normalize edge: payload shape', () => {
  it('wrong object type yields nothing', () => {
    expect(normalizeInstagramWebhook({ ...igMessaging({ sender: { id: 'u' }, message: { mid: 'm', text: 'x' } }), object: 'page' })).toEqual([])
    expect(normalizeFacebookWebhook({ object: 'instagram', entry: [] })).toEqual([])
  })

  it('non-object / malformed payloads yield nothing without throwing', () => {
    for (const payload of [null, undefined, 42, 'x', [], {}, { object: 'instagram' }, { object: 'instagram', entry: {} }]) {
      expect(() => normalizeInstagramWebhook(payload)).not.toThrow()
      expect(normalizeInstagramWebhook(payload)).toEqual([])
    }
  })

  // BUG (low; payloads are signed by Meta): PayloadSchema validates every entry up front, so one bad entry drops the batch.
  it('BUG: one malformed entry does not drop the valid entries of the same batch', () => {
    const payload = {
      object: 'instagram',
      entry: [
        { id: IG_ACCOUNT, time: T, messaging: [{ sender: { id: 'u1' }, recipient: { id: IG_ACCOUNT }, timestamp: T, message: { mid: 'm1', text: 'hi' } }] },
        { time: T, messaging: [] }, // missing id
      ],
    }
    expect(normalizeInstagramWebhook(payload)).toHaveLength(1)
  })

  // BUG (low): toIso() calls toISOString() on an invalid Date and throws; ingestWebhook then returns 500 and Meta
  // redelivers the same poison payload, losing every event in the batch.
  it('BUG: an out-of-range timestamp on one item does not throw away the whole batch', () => {
    const payload = igMessaging(
      { sender: { id: 'u1' }, message: { mid: 'm1', text: 'ok' } },
      { sender: { id: 'u2' }, timestamp: 1e20, message: { mid: 'm2', text: 'bad time' } },
    )
    expect(() => normalizeInstagramWebhook(payload)).not.toThrow()
    expect(normalizeInstagramWebhook(payload)).toHaveLength(2)
  })

  it('unknown change fields and unknown messaging keys are ignored', () => {
    expect(
      normalizeInstagramWebhook({
        object: 'instagram',
        entry: [{ id: IG_ACCOUNT, time: T / 1000, changes: [{ field: 'mentions', value: { media_id: 'x' } }] }],
      }),
    ).toEqual([])
    expect(
      normalizeInstagramWebhook(igMessaging({ sender: { id: 'u1' }, message_edit: { mid: 'm', text: 'edited' } })),
    ).toEqual([])
    expect(normalizeInstagramWebhook(igMessaging({ sender: { id: 'u1' }, reaction: { mid: 'm', action: 'react' } }))).toEqual([])
  })
})

describe('normalize edge: instagram messaging', () => {
  it('messages without mid are dropped; postbacks without mid get a sender+timestamp dedup key', () => {
    expect(normalizeInstagramWebhook(igMessaging({ sender: { id: 'u1' }, message: { text: 'x' } }))).toEqual([])
    expect(normalizeInstagramWebhook(igMessaging({ sender: { id: 'u1' }, postback: { payload: 'r:a:b:c' } }))).toEqual([
      expect.objectContaining({ type: 'postback', messageId: null, dedupKey: `instagram:postback:u1:${T}`, title: null }),
    ])
  })

  it('anything sent by the account itself is dropped, even without is_echo', () => {
    expect(normalizeInstagramWebhook(igMessaging({ sender: { id: IG_ACCOUNT }, message: { mid: 'm', text: 'x' } }))).toEqual([])
    expect(normalizeInstagramWebhook(igMessaging({ sender: { id: IG_ACCOUNT }, postback: { mid: 'p', payload: 'x' } }))).toEqual([])
  })

  it('postback wins over a message on the same item', () => {
    expect(
      normalizeInstagramWebhook(
        igMessaging({ sender: { id: 'u1' }, message: { mid: 'm', text: 'x' }, postback: { mid: 'p', payload: 'pl' } }),
      ),
    ).toMatchObject([{ type: 'postback', payload: 'pl' }])
  })

  it('quick replies become postbacks keyed by message mid', () => {
    expect(
      normalizeInstagramWebhook(igMessaging({ sender: { id: 'u1' }, message: { mid: 'mq', quick_reply: { payload: 'qp' } } })),
    ).toEqual([expect.objectContaining({ type: 'postback', payload: 'qp', title: null, dedupKey: 'instagram:message:mq' })])
  })

  it('whitespace-only DMs have null text', () => {
    expect(normalizeInstagramWebhook(igMessaging({ sender: { id: 'u1' }, message: { mid: 'm', text: '  \n ' } }))).toMatchObject([
      { type: 'dm_received', text: null },
    ])
  })

  it('a reply to a message (not a story) is a DM', () => {
    expect(
      normalizeInstagramWebhook(igMessaging({ sender: { id: 'u1' }, message: { mid: 'm', text: 'yes', reply_to: { mid: 'older' } } })),
    ).toMatchObject([{ type: 'dm_received', text: 'yes' }])
  })

  it('story replies: reaction iff text has no letters or digits', () => {
    const story = (text?: string) =>
      normalizeInstagramWebhook(
        igMessaging({ sender: { id: 'u1' }, message: { mid: 'm', ...(text !== undefined ? { text } : {}), reply_to: { story: { id: 's' } } } }),
      )[0]
    expect(story('❤️')).toMatchObject({ type: 'story_reply', text: '❤️', isReaction: true })
    expect(story('🔥 love it')).toMatchObject({ isReaction: false })
    expect(story('100')).toMatchObject({ isReaction: false })
    expect(story()).toMatchObject({ text: null, isReaction: false })
  })

  it('timestamps: milliseconds kept, seconds scaled', () => {
    const at = new Date(T).toISOString()
    expect(normalizeInstagramWebhook(igMessaging({ sender: { id: 'u1' }, message: { mid: 'm', text: 'x' } }))[0]?.occurredAt).toBe(at)
    expect(
      normalizeInstagramWebhook(igMessaging({ sender: { id: 'u1' }, timestamp: T / 1000, message: { mid: 'm', text: 'x' } }))[0]?.occurredAt,
    ).toBe(at)
  })
})

describe('normalize edge: instagram comments', () => {
  const value = { id: 'c1', text: 'GUIDE', from: { id: 'u2', username: 'priya' }, media: { id: 'media1' } }

  it('missing text defaults to empty, missing media drops the comment', () => {
    const { text: _t, ...noText } = value
    expect(normalizeInstagramWebhook(igComment(noText))).toMatchObject([{ type: 'comment_created', text: '' }])
    const { media: _m, ...noMedia } = value
    expect(normalizeInstagramWebhook(igComment(noMedia))).toEqual([])
  })

  it('missing username is null; own comments are dropped', () => {
    expect(normalizeInstagramWebhook(igComment({ ...value, from: { id: 'u2' } }))).toMatchObject([{ senderUsername: null }])
    expect(normalizeInstagramWebhook(igComment({ ...value, from: { id: IG_ACCOUNT } }))).toEqual([])
  })

  it('entry time in seconds or missing', () => {
    expect(normalizeInstagramWebhook(igComment(value))[0]?.occurredAt).toBe(new Date(T).toISOString())
    const noTime = { object: 'instagram', entry: [{ id: IG_ACCOUNT, changes: [{ field: 'comments', value }] }] }
    expect(normalizeInstagramWebhook(noTime)).toHaveLength(1)
  })

  // Unverified: whether Meta ever sends text: null. z.string().default('') only covers a missing key, so null drops the comment.
  it('comment with explicit null text is currently dropped (documents behaviour)', () => {
    expect(normalizeInstagramWebhook(igComment({ ...value, text: null }))).toEqual([])
  })
})

describe('normalize edge: facebook feed', () => {
  it('only item=comment verb=add creates events', () => {
    expect(normalizeFacebookWebhook(fbComment())).toMatchObject([
      { platform: 'facebook', type: 'comment_created', commentId: 'pc1', mediaId: `${FB_PAGE}_post1`, senderName: 'Priya' },
    ])
    for (const verb of ['edited', 'remove', 'hide']) expect(normalizeFacebookWebhook(fbComment({ verb }))).toEqual([])
    for (const item of ['reaction', 'status', 'post', 'like']) expect(normalizeFacebookWebhook(fbComment({ item }))).toEqual([])
  })

  it('drops page-authored comments and comments missing ids or sender', () => {
    expect(normalizeFacebookWebhook(fbComment({ from: { id: FB_PAGE, name: 'Page' } }))).toEqual([])
    expect(normalizeFacebookWebhook(fbComment({ comment_id: undefined }))).toEqual([])
    expect(normalizeFacebookWebhook(fbComment({ post_id: undefined }))).toEqual([])
    expect(normalizeFacebookWebhook(fbComment({ from: undefined }))).toEqual([])
  })

  it('photo comments without message have empty text; created_time seconds is scaled', () => {
    expect(normalizeFacebookWebhook(fbComment({ message: undefined }))).toMatchObject([
      { text: '', occurredAt: new Date(T).toISOString() },
    ])
  })

  it('instagram comment fields on a page payload are ignored', () => {
    const payload = { object: 'page', entry: [{ id: FB_PAGE, changes: [{ field: 'comments', value: { id: 'x' } }] }] }
    expect(normalizeFacebookWebhook(payload)).toEqual([])
  })

  it('messenger DMs use the facebook platform in the dedup key', () => {
    const payload = {
      object: 'page',
      entry: [{ id: FB_PAGE, time: T, messaging: [{ sender: { id: 'psid' }, recipient: { id: FB_PAGE }, timestamp: T, message: { mid: 'm.fb', text: 'hey' } }] }],
    }
    expect(normalizeFacebookWebhook(payload)).toMatchObject([{ platform: 'facebook', dedupKey: 'facebook:message:m.fb' }])
  })
})
