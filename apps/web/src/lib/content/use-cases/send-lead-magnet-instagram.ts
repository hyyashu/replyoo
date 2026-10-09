import { CONNECT_FAQ, FREE_FAQ, commentTrigger } from '@/lib/content/shared'
import type { MarketingPage } from '@/lib/content/types'
import { DEFAULT_RECIPE } from '@/lib/recipe'

export const sendLeadMagnetInstagram: MarketingPage = {
  slug: 'send-lead-magnet-instagram',
  name: 'Lead magnets',
  title: 'Deliver your lead magnet automatically on Instagram',
  metaTitle: 'Send a lead magnet in Instagram DMs',
  description:
    'Give away a guide, checklist or template on Instagram. Replyooo sends it to everyone who comments your keyword, and can collect their email first.',
  lead: 'Tell your followers to comment a word for your free guide, checklist or template. Replyooo sends it to each of them and, if you want, asks for their email before it goes out.',
  recipe: {
    ...DEFAULT_RECIPE,
    trigger: commentTrigger('CHECKLIST'),
    opener: { enabled: true, text: 'Hey {{first_name}}! Tap below and I’ll send the checklist 👇', buttonLabel: 'Send it to me' },
    collect: {
      kind: 'email',
      question: "What's your email? I'll send a copy there too.",
      retryText: "Hmm, that doesn't look like an email. Mind trying again?",
    },
    tags: ['email-lead'],
    message: { text: 'Here you go! 🎉', imageUrl: '', links: [{ label: 'Download the checklist', url: 'https://example.com/checklist' }] },
  },
  mode: 'dm',
  username: 'maya.makes',
  steps: [
    { title: 'Post the offer', body: 'Add “comment CHECKLIST and I’ll send it” to your reel or post.' },
    { title: 'Set the keyword and the file link', body: 'Write the DM and add the link to your guide, PDF or template page.' },
    { title: 'Grow your list while you sleep', body: 'Every commenter gets it automatically, and their email is saved if you asked for it.' },
  ],
  points: [
    { title: 'No manual sending', body: 'Whether 5 or 500 people comment, nobody waits for you to find their name and paste the link.' },
    { title: 'Email before delivery', body: 'Ask for an email first so the lead magnet actually builds a list, not just link clicks.' },
    { title: 'Follow first, if you like', body: 'Add a follow gate so the giveaway grows your audience as well.' },
    { title: 'See what worked', body: 'Contacts are tagged per automation, so you can see which post brought in which leads.' },
  ],
  faqs: [
    {
      question: 'How do I send a free guide to people who comment on Instagram?',
      answer:
        'Create a comment automation with your keyword, write the DM with a link to the guide, and tell your audience which word to comment. Replyooo replies to each comment and sends the DM.',
    },
    {
      question: 'Can I get their email address before sending it?',
      answer: 'Yes. Turn on the email question and Replyooo asks for the address in the chat, checks it, saves it on the contact, and then sends the link.',
    },
    CONNECT_FAQ,
    FREE_FAQ,
  ],
  related: ['sell-products-from-instagram-comments', 'grow-followers-with-giveaways', 'book-calls-from-instagram-dms'],
  updated: '2026-10-09',
}
