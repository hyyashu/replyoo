export const IG_ACCOUNT = '17841400000000001'
export const FB_PAGE = '104000000000001'
export const T = 1791280800000 // 2026-10-06T10:00:00.000Z

const igMessaging = (item: Record<string, unknown>) => ({
  object: 'instagram',
  entry: [{ id: IG_ACCOUNT, time: T, messaging: [{ recipient: { id: IG_ACCOUNT }, timestamp: T, ...item }] }],
})

export const ig = {
  dm: igMessaging({ sender: { id: 'igsid_1' }, message: { mid: 'mid.dm1', text: 'PRICE?' } }),
  attachmentOnly: igMessaging({
    sender: { id: 'igsid_1' },
    message: { mid: 'mid.img', attachments: [{ type: 'image', payload: { url: 'https://x' } }] },
  }),
  echo: igMessaging({ sender: { id: IG_ACCOUNT }, message: { mid: 'mid.echo', text: 'hi', is_echo: true } }),
  deleted: igMessaging({ sender: { id: 'igsid_1' }, message: { mid: 'mid.del', is_deleted: true } }),
  read: igMessaging({ sender: { id: 'igsid_1' }, read: { mid: 'mid.dm1' } }),
  quickReply: igMessaging({
    sender: { id: 'igsid_1' },
    message: { mid: 'mid.qr', text: 'Send it', quick_reply: { payload: 'r:run1:s1:b1' } },
  }),
  postback: igMessaging({
    sender: { id: 'igsid_1' },
    postback: { mid: 'mid.pb', title: 'Send it', payload: 'r:run1:s1:b1' },
  }),
  storyReply: igMessaging({
    sender: { id: 'igsid_1' },
    message: { mid: 'mid.story', text: 'I want this', reply_to: { story: { id: 'story1', url: 'https://x' } } },
  }),
  storyReaction: igMessaging({
    sender: { id: 'igsid_1' },
    message: { mid: 'mid.react', text: '😍🔥', reply_to: { story: { id: 'story1', url: 'https://x' } } },
  }),
  comment: {
    object: 'instagram',
    entry: [
      {
        id: IG_ACCOUNT,
        time: T / 1000,
        changes: [
          {
            field: 'comments',
            value: {
              id: 'c1',
              text: 'GUIDE please',
              from: { id: 'igsid_2', username: 'priya' },
              media: { id: 'media1', media_product_type: 'FEED' },
            },
          },
        ],
      },
    ],
  },
  ownComment: {
    object: 'instagram',
    entry: [
      {
        id: IG_ACCOUNT,
        time: T / 1000,
        changes: [
          {
            field: 'comments',
            value: { id: 'c2', text: 'Sent you a DM!', from: { id: IG_ACCOUNT, username: 'acme' }, media: { id: 'media1' } },
          },
        ],
      },
    ],
  },
  batch: {
    object: 'instagram',
    entry: [
      {
        id: IG_ACCOUNT,
        time: T,
        messaging: [
          { sender: { id: 'igsid_1' }, recipient: { id: IG_ACCOUNT }, timestamp: T, message: { mid: 'm.a', text: 'a' } },
          { sender: { id: 'igsid_3' }, recipient: { id: IG_ACCOUNT }, timestamp: T, message: { mid: 'm.b', text: 'b' } },
          { garbage: true },
        ],
      },
    ],
  },
}

const fbFeed = (value: Record<string, unknown>) => ({
  object: 'page',
  entry: [{ id: FB_PAGE, time: T / 1000, changes: [{ field: 'feed', value }] }],
})

export const fb = {
  dm: {
    object: 'page',
    entry: [
      {
        id: FB_PAGE,
        time: T,
        messaging: [{ sender: { id: 'psid_1' }, recipient: { id: FB_PAGE }, timestamp: T, message: { mid: 'm_fb1', text: 'hello' } }],
      },
    ],
  },
  postback: {
    object: 'page',
    entry: [
      {
        id: FB_PAGE,
        time: T,
        messaging: [
          {
            sender: { id: 'psid_1' },
            recipient: { id: FB_PAGE },
            timestamp: T,
            postback: { mid: 'm_fbpb', title: 'Pricing', payload: 'ib:auto1:0' },
          },
        ],
      },
    ],
  },
  comment: fbFeed({
    item: 'comment',
    verb: 'add',
    comment_id: '104_c1',
    post_id: '104_p1',
    message: 'guide',
    from: { id: 'fbuser_1', name: 'Priya Sharma' },
    created_time: T / 1000,
  }),
  editedComment: fbFeed({
    item: 'comment',
    verb: 'edited',
    comment_id: '104_c1',
    post_id: '104_p1',
    message: 'guide!!',
    from: { id: 'fbuser_1', name: 'Priya Sharma' },
  }),
  pageComment: fbFeed({
    item: 'comment',
    verb: 'add',
    comment_id: '104_c2',
    post_id: '104_p1',
    message: 'Check your inbox',
    from: { id: FB_PAGE, name: 'Acme' },
  }),
  statusPost: fbFeed({ item: 'status', verb: 'add', post_id: '104_p2', message: 'New post' }),
}
