import { CONNECT_FAQ, FREE_FAQ, commentTrigger } from '@/lib/content/shared'
import type { MarketingPage } from '@/lib/content/types'
import { DEFAULT_RECIPE } from '@/lib/recipe'

export const fitnessCreators: MarketingPage = {
  slug: 'fitness-creators',
  name: 'Fitness creators',
  title: 'Instagram DM automation for fitness creators',
  metaTitle: 'Instagram DM automation for fitness creators',
  description:
    'Send your workout plan, meal guide or programme link to everyone who comments, and grow your followers and email list at the same time.',
  lead: 'Post a workout, ask people to comment a word, and Replyooo sends the plan to every one of them. Ask for a follow first and you grow while you train.',
  recipe: {
    ...DEFAULT_RECIPE,
    trigger: commentTrigger('PLAN'),
    opener: { enabled: true, text: 'Hey {{first_name}}! Tap below for your 4-week plan 👇', buttonLabel: 'Send my plan' },
    followGate: { ...DEFAULT_RECIPE.followGate, enabled: true },
    message: { text: "Let's go! 💪 Here's the plan.", imageUrl: '', links: [{ label: 'Get the plan', url: 'https://example.com/plan' }] },
  },
  mode: 'dm',
  username: 'maya.fit',
  steps: [
    { title: 'Post the workout', body: 'Share the routine and tell viewers to comment PLAN for the full programme.' },
    { title: 'Ask for the follow', body: 'Turn on the follow gate so the plan grows your audience too.' },
    { title: 'Reach everyone who comments', body: 'Each commenter receives the plan without you replying one by one.' },
  ],
  points: [
    { title: 'Programme in the inbox', body: 'People get the plan straight away, so the post’s momentum turns into signups.' },
    { title: 'Followers from every post', body: 'A follow gate makes each plan offer a growth tool.' },
    { title: 'Email for the newsletter', body: 'Add an email question to build a list for tips and launches.' },
    { title: 'A different offer per post', body: 'Use a keyword per workout and send each one a different programme.' },
  ],
  faqs: [
    {
      question: 'How do fitness creators use Instagram DM automation?',
      answer: 'They post a workout, ask followers to comment a keyword, and Replyooo sends the plan or programme link to everyone who does, often after a follow check and an email question.',
    },
    {
      question: 'Can I sell my programme this way?',
      answer: 'Yes. Send the sales page as a link button. Replyooo delivers the link; the checkout happens on your own page.',
    },
    CONNECT_FAQ,
    FREE_FAQ,
  ],
  related: ['coaches', 'online-shops', 'photographers-and-freelancers'],
  updated: '2026-10-09',
}
