import type { FlowTemplate } from './types'

export const followGate: FlowTemplate = {
  key: 'follow_gate',
  title: 'Grow followers from comments',
  description: 'Incentivize a follow before you share your link or freebie',
  categories: ['grow_followers', 'recommended'],
  platforms: ['instagram'],
  flow: {
    trigger: {
      type: 'comment_keyword',
      posts: { mode: 'any' },
      keywords: ['FREEBIE'],
      match: 'contains',
      publicReplies: ['Check your DMs! 📩'],
    },
    start: 'opener',
    steps: {
      opener: {
        type: 'send_message',
        text: 'Hey {{first_name|there}}! Want the freebie? Tap below 👇',
        buttons: [{ type: 'reply', id: 'want', label: 'Yes please!', next: 'check' }],
      },
      check: { type: 'check_follow', following: 'deliver', notFollowing: 'ask_follow' },
      ask_follow: {
        type: 'send_message',
        text: "Looks like you're not following yet 👀 Follow me, then tap the button below.",
        buttons: [{ type: 'reply', id: 'followed', label: 'I followed ✓', next: 'recheck' }],
      },
      recheck: { type: 'check_follow', following: 'deliver', notFollowing: 'remind_follow' },
      remind_follow: {
        type: 'send_message',
        text: "Hmm, I still don't see the follow 🤔 Follow me, then tap the button again.",
        buttons: [{ type: 'reply', id: 'followed_again', label: 'I followed ✓', next: 'recheck' }],
      },
      deliver: {
        type: 'send_message',
        text: "Thanks for following! Here's your freebie 🎁",
        buttons: [{ type: 'url', label: 'Get it', url: 'https://example.com/freebie' }],
      },
    },
  },
}
