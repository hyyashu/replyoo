import { CONNECT_FAQ, FREE_FAQ } from '@/lib/content/shared'
import type { MarketingPage } from '@/lib/content/types'
import { DEFAULT_RECIPE } from '@/lib/recipe'

export const photographersAndFreelancers: MarketingPage = {
  slug: 'photographers-and-freelancers',
  name: 'Photographers & freelancers',
  title: 'Instagram DM automation for photographers and freelancers',
  metaTitle: 'Instagram DM automation for photographers and freelancers',
  description:
    'Answer “how much?” and “are you available?” on Instagram automatically. Send your price list, portfolio and booking link when someone asks.',
  lead: 'Prospects ask the same few questions: price, availability, how to book. Replyooo answers them in the DMs with your price list and calendar, so you can get on with the work.',
  recipe: {
    ...DEFAULT_RECIPE,
    trigger: { type: 'dm_keyword', keywords: ['PRICES', 'RATES'], match: 'contains' },
    opener: { enabled: false, text: DEFAULT_RECIPE.opener.text, buttonLabel: DEFAULT_RECIPE.opener.buttonLabel },
    collect: {
      kind: 'email',
      question: "What's your email? I'll send the full price list there too.",
      retryText: "Hmm, that doesn't look like an email. Mind trying again?",
    },
    tags: ['email-lead'],
    message: { text: 'Thanks! 📸 Here are my packages and availability.', imageUrl: '', links: [{ label: 'View packages', url: 'https://example.com/packages' }, { label: 'Check dates', url: 'https://example.com/book' }] },
  },
  mode: 'dm',
  username: 'maya.photo',
  steps: [
    { title: 'Set the question words', body: 'Reply when someone DMs PRICES or RATES, or add them as conversation starters.' },
    { title: 'Send packages and a calendar', body: 'Include your price list and booking link as buttons.' },
    { title: 'Keep the contact', body: 'Ask for an email so you can follow up with people who don’t book straight away.' },
  ],
  points: [
    { title: 'Quotes without the typing', body: 'The first reply is instant and always has the right link.' },
    { title: 'Show your portfolio', body: 'Add an image or link to your best work in the message.' },
    { title: 'Follow-up details saved', body: 'Emails and tags live in Contacts, ready for a personal reply.' },
    { title: 'More time for work', body: 'The repetitive enquiries are handled, so you answer only the serious ones.' },
  ],
  faqs: [
    {
      question: 'Can a freelancer auto-reply to Instagram DMs about pricing?',
      answer: 'Yes. Set a DM keyword like PRICES, or a conversation starter, and write a reply with your price list and booking link.',
    },
    {
      question: 'Will it replace my own replies?',
      answer: 'No. It handles the first, repetitive questions. Anyone who needs a custom quote can still message you directly.',
    },
    CONNECT_FAQ,
    FREE_FAQ,
  ],
  related: ['coaches', 'online-shops', 'fitness-creators'],
  updated: '2026-10-09',
}
