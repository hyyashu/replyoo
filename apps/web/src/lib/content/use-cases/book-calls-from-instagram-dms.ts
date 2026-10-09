import { CONNECT_FAQ, FREE_FAQ } from '@/lib/content/shared'
import type { MarketingPage } from '@/lib/content/types'
import { DEFAULT_RECIPE } from '@/lib/recipe'

export const bookCallsFromInstagramDms: MarketingPage = {
  slug: 'book-calls-from-instagram-dms',
  name: 'Bookings',
  title: 'Book calls and appointments from Instagram DMs',
  metaTitle: 'Get bookings from Instagram DMs',
  description:
    'Answer “how do I book?” instantly. Replyooo sends your booking link when someone comments, messages a keyword or taps a conversation starter.',
  lead: 'Most booking enquiries are the same question. Send your booking link the moment someone comments, DMs a keyword, or taps a starter, and take their phone number while you’re there.',
  recipe: {
    ...DEFAULT_RECIPE,
    trigger: { type: 'dm_keyword', keywords: ['BOOK'], match: 'contains' },
    opener: { enabled: false, text: DEFAULT_RECIPE.opener.text, buttonLabel: DEFAULT_RECIPE.opener.buttonLabel },
    collect: {
      kind: 'phone',
      question: "What's the best number to reach you on?",
      retryText: "That doesn't look like a phone number. Could you send it again?",
    },
    tags: ['phone-lead'],
    message: { text: 'Thanks! 🙌 Pick a time that suits you here.', imageUrl: '', links: [{ label: 'Book a call', url: 'https://example.com/book' }] },
  },
  mode: 'dm',
  username: 'maya.makes',
  steps: [
    { title: 'Pick how people ask', body: 'Trigger on a comment keyword, a DM keyword, or a tappable conversation starter like “How do I book?”.' },
    { title: 'Add your booking link', body: 'Send your calendar or booking page as a link button.' },
    { title: 'Optionally take a number', body: 'Ask for a phone number first so you can follow up with people who don’t book.' },
  ],
  points: [
    { title: 'Instant answers', body: 'People get the booking link while they’re still interested, not hours later.' },
    { title: 'Works in the inbox and the comments', body: 'The same link can go out from a comment, a DM or a conversation starter.' },
    { title: 'Collect a number', body: 'Phone capture saves the number on the contact for follow-up.' },
    { title: 'A reminder for quiet leads', body: 'Add one reminder for people who start the chat and then go quiet.' },
  ],
  faqs: [
    {
      question: 'Can I automatically send a booking link on Instagram?',
      answer: 'Yes. Set a trigger, such as a DM keyword or a comment, and write the message with your booking page as a link button.',
    },
    {
      question: 'Does Replyooo book the appointment itself?',
      answer: 'No. It sends people to your own booking page or calendar, so you keep using whichever scheduling tool you already have.',
    },
    CONNECT_FAQ,
    FREE_FAQ,
  ],
  related: ['send-lead-magnet-instagram', 'sell-products-from-instagram-comments', 'grow-followers-with-giveaways'],
  updated: '2026-10-09',
}
