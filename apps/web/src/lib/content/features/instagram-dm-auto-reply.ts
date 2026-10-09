import { CONNECT_FAQ, FREE_FAQ } from '@/lib/content/shared'
import type { MarketingPage } from '@/lib/content/types'
import { DEFAULT_RECIPE } from '@/lib/recipe'

export const instagramDmAutoReply: MarketingPage = {
  slug: 'instagram-dm-auto-reply',
  name: 'DM auto-reply',
  title: 'Instagram DM auto-reply and conversation starters',
  metaTitle: 'Instagram DM auto-reply and conversation starters',
  description:
    'Auto-reply to Instagram DMs by keyword and add conversation starters, so common questions about pricing, shipping or booking are answered instantly.',
  lead: 'Answer the questions you get every day without typing them every time. Reply to DM keywords automatically and add tappable starters to every new chat.',
  recipe: {
    ...DEFAULT_RECIPE,
    trigger: {
      type: 'ice_breaker',
      items: [
        { question: 'What does it cost?', answer: 'Plans start free. Here’s the full breakdown 👇', links: [{ label: 'See pricing', url: 'https://example.com/pricing' }] },
        { question: 'How do I book?', answer: 'You can book a time here 👇', links: [{ label: 'Book a call', url: 'https://example.com/book' }] },
        { question: 'Where is my order?', answer: 'Send your order number and we’ll check it for you.', links: [] },
      ],
    },
  },
  mode: 'dm',
  username: 'maya.makes',
  steps: [
    { title: 'Write the questions', body: 'Add the common questions people ask, each with the answer and up to three link buttons.' },
    { title: 'Show them in every new chat', body: 'Conversation starters appear as tappable questions when someone opens a chat with you.' },
    { title: 'Or reply to keywords', body: 'Set a keyword, or reply to any message, and send the answer straight away.' },
  ],
  points: [
    { title: 'Tappable questions', body: 'Customers pick a question instead of waiting for you to reply.' },
    { title: 'DM keyword replies', body: 'When someone messages a word like PRICE, they get the right answer immediately.' },
    { title: 'Links and buttons', body: 'Answers can carry link buttons to your pricing, booking or shop page.' },
    { title: 'Everyone becomes a contact', body: 'People who message you are saved in Contacts, with tags, for later follow-up.' },
  ],
  faqs: [
    {
      question: 'How do I auto-reply to Instagram DMs?',
      answer:
        'Create an automation that triggers on a keyword in a DM, or on any DM, and write the reply. You can also add conversation starters, which show up as tappable questions in new chats.',
    },
    {
      question: 'What are conversation starters?',
      answer: 'They are questions shown in a new Instagram chat. When the person taps one, Replyooo sends the answer you wrote for it.',
    },
    CONNECT_FAQ,
    FREE_FAQ,
  ],
  related: ['instagram-comment-to-dm', 'collect-emails-instagram-dm', 'instagram-story-reply-automation'],
  updated: '2026-10-09',
}
