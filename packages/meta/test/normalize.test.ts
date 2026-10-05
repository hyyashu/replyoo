import { describe, expect, it } from 'vitest'
import { normalizeFacebookWebhook, normalizeInstagramWebhook } from '../src'
import { FB_PAGE, fb, IG_ACCOUNT, ig, T } from './fixtures'

const at = new Date(T).toISOString()

describe('normalizeInstagramWebhook', () => {
  it('normalizes DMs', () => {
    expect(normalizeInstagramWebhook(ig.dm)).toEqual([
      {
        platform: 'instagram',
        type: 'dm_received',
        accountExternalId: IG_ACCOUNT,
        senderId: 'igsid_1',
        dedupKey: 'instagram:message:mid.dm1',
        occurredAt: at,
        messageId: 'mid.dm1',
        text: 'PRICE?',
      },
    ])
  })

  it('keeps attachment-only messages with null text', () => {
    expect(normalizeInstagramWebhook(ig.attachmentOnly)).toMatchObject([{ type: 'dm_received', text: null }])
  })

  it('ignores echoes, deletions and read receipts', () => {
    expect(normalizeInstagramWebhook(ig.echo)).toEqual([])
    expect(normalizeInstagramWebhook(ig.deleted)).toEqual([])
    expect(normalizeInstagramWebhook(ig.read)).toEqual([])
  })

  it('turns postbacks and quick replies into postback events', () => {
    expect(normalizeInstagramWebhook(ig.postback)).toEqual([
      {
        platform: 'instagram',
        type: 'postback',
        accountExternalId: IG_ACCOUNT,
        senderId: 'igsid_1',
        dedupKey: 'instagram:postback:mid.pb',
        occurredAt: at,
        messageId: 'mid.pb',
        payload: 'r:run1:s1:b1',
        title: 'Send it',
      },
    ])
    expect(normalizeInstagramWebhook(ig.quickReply)).toMatchObject([
      { type: 'postback', payload: 'r:run1:s1:b1', dedupKey: 'instagram:message:mid.qr' },
    ])
  })

  it('detects story replies and emoji-only reactions', () => {
    expect(normalizeInstagramWebhook(ig.storyReply)).toMatchObject([
      { type: 'story_reply', text: 'I want this', isReaction: false },
    ])
    expect(normalizeInstagramWebhook(ig.storyReaction)).toMatchObject([
      { type: 'story_reply', text: '😍🔥', isReaction: true },
    ])
  })

  it('normalizes comments', () => {
    expect(normalizeInstagramWebhook(ig.comment)).toEqual([
      {
        platform: 'instagram',
        type: 'comment_created',
        accountExternalId: IG_ACCOUNT,
        senderId: 'igsid_2',
        senderUsername: 'priya',
        senderName: null,
        dedupKey: 'instagram:comment:c1',
        occurredAt: at,
        commentId: 'c1',
        mediaId: 'media1',
        text: 'GUIDE please',
      },
    ])
  })

  it('ignores comments made by the account itself', () => {
    expect(normalizeInstagramWebhook(ig.ownComment)).toEqual([])
  })

  it('handles batches and skips malformed items', () => {
    expect(normalizeInstagramWebhook(ig.batch).map((e) => e.senderId)).toEqual(['igsid_1', 'igsid_3'])
  })

  it('returns [] for other objects and garbage', () => {
    expect(normalizeInstagramWebhook(fb.dm)).toEqual([])
    expect(normalizeInstagramWebhook(null)).toEqual([])
    expect(normalizeInstagramWebhook({ object: 'instagram', entry: 'nope' })).toEqual([])
  })
})

describe('normalizeFacebookWebhook', () => {
  it('normalizes Messenger DMs and postbacks', () => {
    expect(normalizeFacebookWebhook(fb.dm)).toMatchObject([
      { platform: 'facebook', type: 'dm_received', accountExternalId: FB_PAGE, senderId: 'psid_1', text: 'hello' },
    ])
    expect(normalizeFacebookWebhook(fb.postback)).toMatchObject([
      { type: 'postback', payload: 'ib:auto1:0', dedupKey: 'facebook:postback:m_fbpb' },
    ])
  })

  it('normalizes new comments only', () => {
    expect(normalizeFacebookWebhook(fb.comment)).toEqual([
      {
        platform: 'facebook',
        type: 'comment_created',
        accountExternalId: FB_PAGE,
        senderId: 'fbuser_1',
        senderUsername: null,
        senderName: 'Priya Sharma',
        dedupKey: 'facebook:comment:104_c1',
        occurredAt: at,
        commentId: '104_c1',
        mediaId: '104_p1',
        text: 'guide',
      },
    ])
    expect(normalizeFacebookWebhook(fb.editedComment)).toEqual([])
    expect(normalizeFacebookWebhook(fb.pageComment)).toEqual([])
    expect(normalizeFacebookWebhook(fb.statusPost)).toEqual([])
  })

  it('returns [] for Instagram payloads', () => {
    expect(normalizeFacebookWebhook(ig.dm)).toEqual([])
  })
})
