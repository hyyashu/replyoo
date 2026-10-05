import type { FlowTemplate } from './types'

export const emailList: FlowTemplate = {
  key: 'email_list',
  title: 'Grow your email list',
  description: 'Collect emails from followers before sending the item or link',
  categories: ['collect_leads', 'recommended'],
  platforms: ['instagram', 'facebook'],
  flow: {
    trigger: {
      type: 'comment_keyword',
      posts: { mode: 'any' },
      keywords: ['GUIDE'],
      match: 'contains',
      publicReplies: ['Sent you a DM! 📩', 'Check your inbox ✨'],
    },
    start: 'opener',
    steps: {
      opener: {
        type: 'send_message',
        text: 'Hey {{first_name|there}}! Want the free guide? Tap below 👇',
        buttons: [{ type: 'reply', id: 'yes', label: 'Send it to me', next: 'has_email' }],
      },
      has_email: { type: 'condition', has: 'email', yes: 'deliver', no: 'ask_email' },
      ask_email: {
        type: 'ask',
        question: "What's your email? I'll send a copy there too.",
        saveTo: 'email',
        validate: 'email',
        retryText: "Hmm, that doesn't look like an email. Mind trying again?",
        maxAttempts: 2,
        timeoutMinutes: 1440,
        answered: 'deliver',
        invalid: 'deliver',
      },
      deliver: {
        type: 'send_message',
        text: 'Here you go! 🎉',
        buttons: [{ type: 'url', label: 'Open guide', url: 'https://example.com/guide' }],
        next: 'tag',
      },
      tag: { type: 'tag', add: ['email-lead'] },
    },
  },
}
