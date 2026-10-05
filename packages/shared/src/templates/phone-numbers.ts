import type { FlowTemplate } from './types'

export const phoneNumbers: FlowTemplate = {
  key: 'phone_numbers',
  title: 'Collect phone numbers',
  description: 'Ask commenters for their number and save it as a lead',
  categories: ['collect_leads'],
  platforms: ['instagram', 'facebook'],
  isNew: true,
  flow: {
    trigger: {
      type: 'comment_keyword',
      posts: { mode: 'any' },
      keywords: ['CALL'],
      match: 'contains',
      publicReplies: ['Sent you a DM! 📞'],
    },
    start: 'opener',
    steps: {
      opener: {
        type: 'send_message',
        text: 'Hey {{first_name|there}}! Want us to give you a call? Tap below 👇',
        buttons: [{ type: 'reply', id: 'yes', label: 'Yes, call me', next: 'ask_phone' }],
      },
      ask_phone: {
        type: 'ask',
        question: "What's the best number to reach you on?",
        saveTo: 'phone',
        validate: 'phone',
        retryText: "That doesn't look like a phone number. Could you send it again?",
        maxAttempts: 2,
        timeoutMinutes: 1440,
        answered: 'thanks',
      },
      thanks: { type: 'send_message', text: "Got it! We'll reach out soon 📞", next: 'tag' },
      tag: { type: 'tag', add: ['phone-lead'] },
    },
  },
}
