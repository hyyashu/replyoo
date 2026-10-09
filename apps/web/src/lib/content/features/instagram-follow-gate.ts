import { CONNECT_FAQ, FREE_FAQ, commentTrigger } from '@/lib/content/shared'
import type { MarketingPage } from '@/lib/content/types'
import { DEFAULT_RECIPE } from '@/lib/recipe'

export const instagramFollowGate: MarketingPage = {
  slug: 'instagram-follow-gate',
  name: 'Follow gate',
  title: 'Ask for a follow before the link unlocks',
  metaTitle: 'Instagram follow gate for DM automations',
  description:
    'Turn freebies into followers. Replyooo checks that someone follows your Instagram account before it sends the link, and reminds them if they haven’t.',
  lead: 'Offer a guide, a discount or a link, and make following you the price of getting it. Replyooo checks the follow automatically, so you never verify anyone by hand.',
  recipe: {
    ...DEFAULT_RECIPE,
    trigger: commentTrigger('GUIDE'),
    opener: { enabled: true, text: 'Hey {{first_name}}! Tap below to get the guide 👇', buttonLabel: 'Send it to me' },
    followGate: { ...DEFAULT_RECIPE.followGate, enabled: true },
    message: { text: "You're in! 🎉 Here's the guide.", imageUrl: '', links: [{ label: 'Get the guide', url: 'https://example.com/guide' }] },
  },
  mode: 'dm',
  username: 'maya.makes',
  steps: [
    { title: 'Turn on the follow gate', body: 'Switch it on in any comment, story or DM automation. No extra tool needed.' },
    { title: 'Write the ask', body: 'Tell people to follow you first, and set the label of the button they tap afterwards.' },
    { title: 'Replyooo checks for you', body: 'When they tap, Replyooo looks up whether they follow you. If they do, the link is sent. If not, they get your reminder.' },
  ],
  points: [
    { title: 'Followers, not just clicks', body: 'Every freebie you give away grows your audience instead of leaking out through a link.' },
    { title: 'Your wording', body: 'Edit the ask, the button label and the “still not following” reminder in your own voice.' },
    { title: 'No manual checking', body: 'People who already follow you skip straight to the link, so existing fans never hit a wall.' },
    { title: 'Combine it with lead capture', body: 'Add an email or phone question after the follow check to build a list from the same flow.' },
  ],
  faqs: [
    {
      question: 'Can Instagram automation make people follow me first?',
      answer:
        'Yes. With a follow gate, Replyooo asks the person to follow you, then checks when they tap the button. The link is only sent once the follow is confirmed, and a reminder goes out if it isn’t.',
    },
    {
      question: 'What happens if someone already follows me?',
      answer: 'They get the link straight away. The follow ask is only shown to people who aren’t following yet.',
    },
    CONNECT_FAQ,
    FREE_FAQ,
  ],
  related: ['instagram-comment-to-dm', 'collect-emails-instagram-dm', 'instagram-story-reply-automation'],
  updated: '2026-10-09',
}
