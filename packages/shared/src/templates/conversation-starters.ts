import type { FlowTemplate } from './types'

export const conversationStarters: FlowTemplate = {
  key: 'conversation_starters',
  title: 'Conversation starters',
  description: 'Show tappable questions when someone opens a new DM — each tap gets an instant answer',
  categories: ['setup_inbox', 'recommended'],
  platforms: ['instagram', 'facebook'],
  isNew: true,
  flow: {
    trigger: {
      type: 'ice_breaker',
      items: [
        { question: 'What do you offer?', startStep: 'offer' },
        { question: 'How much does it cost?', startStep: 'pricing' },
        { question: 'How can I contact you?', startStep: 'contact' },
      ],
    },
    start: 'offer',
    steps: {
      offer: { type: 'send_message', text: "Here's what we offer: …" },
      pricing: {
        type: 'send_message',
        text: 'Our pricing is simple 👇',
        buttons: [{ type: 'url', label: 'See pricing', url: 'https://example.com/pricing' }],
      },
      contact: { type: 'send_message', text: 'Just reply here and we will get back to you soon!' },
    },
  },
}
