import { CONNECT_FAQ, FREE_FAQ, commentTrigger } from '@/lib/content/shared'
import type { MarketingPage } from '@/lib/content/types'
import { DEFAULT_RECIPE } from '@/lib/recipe'

export const coaches: MarketingPage = {
  slug: 'coaches',
  name: 'Coaches',
  title: 'Instagram DM automation for coaches',
  metaTitle: 'Instagram DM automation for coaches',
  description:
    'Turn Instagram comments into discovery calls and email subscribers. Replyooo sends your free guide or booking link to every follower who asks.',
  lead: 'Your content brings in the questions. Replyooo answers them: it sends your free guide, collects an email, and shares your booking link while you’re with clients.',
  recipe: {
    ...DEFAULT_RECIPE,
    trigger: commentTrigger('COACH'),
    opener: { enabled: true, text: 'Hey {{first_name}}! Tap below and I’ll send my free workbook 👇', buttonLabel: 'Send it to me' },
    collect: {
      kind: 'email',
      question: "What's your email? I'll send a copy there too.",
      retryText: "Hmm, that doesn't look like an email. Mind trying again?",
    },
    tags: ['email-lead'],
    message: { text: 'Here’s the workbook! 🎉 Ready to talk? You can book a call below.', imageUrl: '', links: [{ label: 'Get the workbook', url: 'https://example.com/workbook' }, { label: 'Book a call', url: 'https://example.com/book' }] },
  },
  mode: 'dm',
  username: 'maya.coaches',
  steps: [
    { title: 'Offer something useful', body: 'Post a tip, then invite people to comment a word for the workbook behind it.' },
    { title: 'Capture the email', body: 'Replyooo asks for it in the chat and saves it on the contact.' },
    { title: 'Share the next step', body: 'Send the resource and a link to book a call in the same message.' },
  ],
  points: [
    { title: 'Warm leads, not cold DMs', body: 'People who ask for your workbook have already raised their hand.' },
    { title: 'Email list from Instagram', body: 'Every workbook request can add a validated email to your list.' },
    { title: 'Booking link on tap', body: 'Put your calendar next to the resource so interested people can book straight away.' },
    { title: 'Your tone', body: 'Write every message yourself, with the person’s first name filled in.' },
  ],
  faqs: [
    {
      question: 'How can a coach use Instagram DM automation?',
      answer: 'Offer a free workbook or checklist in your posts, let Replyooo deliver it by DM, collect the email, and include your booking link for people ready to talk.',
    },
    {
      question: 'Will my clients think it is a bot?',
      answer: 'You write every message, and it can use the person’s first name. Keep the tone personal and say clearly what they’re getting.',
    },
    CONNECT_FAQ,
    FREE_FAQ,
  ],
  related: ['online-shops', 'fitness-creators', 'photographers-and-freelancers'],
  updated: '2026-10-09',
}
