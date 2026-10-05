import type { FlowTemplate } from './types'

export const commentToDm: FlowTemplate = {
  key: 'comment_to_dm',
  title: 'Send a link from comments',
  description: 'When someone comments a keyword, DM them your link automatically',
  categories: ['recommended', 'sell_products'],
  platforms: ['instagram', 'facebook'],
  flow: {
    trigger: {
      type: 'comment_keyword',
      posts: { mode: 'any' },
      keywords: ['LINK'],
      match: 'contains',
      publicReplies: ['Sent it to your DMs 📩', 'Check your DMs! ✨', 'Just sent it over 🙌'],
    },
    start: 'opener',
    steps: {
      opener: {
        type: 'send_message',
        text: "Hey {{first_name|there}}! Tap below and I'll send you the link 👇",
        buttons: [{ type: 'reply', id: 'get', label: 'Send me the link', next: 'link' }],
      },
      link: {
        type: 'send_message',
        text: 'Here you go! 🎉',
        buttons: [{ type: 'url', label: 'Open link', url: 'https://example.com' }],
      },
    },
  },
}
