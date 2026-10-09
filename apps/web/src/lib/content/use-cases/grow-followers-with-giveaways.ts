import { CONNECT_FAQ, FREE_FAQ, commentTrigger } from '@/lib/content/shared'
import type { MarketingPage } from '@/lib/content/types'
import { DEFAULT_RECIPE } from '@/lib/recipe'

export const growFollowersWithGiveaways: MarketingPage = {
  slug: 'grow-followers-with-giveaways',
  name: 'Follow-to-unlock offers',
  title: 'Grow your followers with a follow-to-unlock offer',
  metaTitle: 'Grow followers with a follow-to-unlock offer',
  description:
    'Offer something free and make a follow the price of getting it. Replyooo checks the follow automatically and sends the reward only to people who follow.',
  lead: 'Run a post where a comment gets a free resource, but only if the person follows you. Replyooo checks it, reminds the people who haven’t, and sends the reward to those who have.',
  recipe: {
    ...DEFAULT_RECIPE,
    trigger: commentTrigger('FREE'),
    opener: { enabled: true, text: 'Hey {{first_name}}! Tap below to claim it 👇', buttonLabel: 'Claim it' },
    followGate: { ...DEFAULT_RECIPE.followGate, enabled: true },
    message: { text: "You're in! 🎉 Enjoy.", imageUrl: '', links: [{ label: 'Claim your reward', url: 'https://example.com/reward' }] },
  },
  mode: 'dm',
  username: 'maya.makes',
  steps: [
    { title: 'Make the offer', body: 'Post the free resource or discount and tell people to comment the keyword.' },
    { title: 'Turn on the follow gate', body: 'Write the ask and a friendly reminder for people who tap without following.' },
    { title: 'Watch the follower count', body: 'People who follow get the reward; the rest are nudged to follow first.' },
  ],
  points: [
    { title: 'A fair swap', body: 'The reward is always delivered, but only after the follow, so the offer earns something back.' },
    { title: 'No manual checking', body: 'You don’t scroll through followers to match names to comments.' },
    { title: 'Existing fans pass straight through', body: 'People who already follow you get the reward immediately.' },
    { title: 'Add an email ask', body: 'Collect an email in the same flow to grow your list as well as your audience.' },
  ],
  faqs: [
    {
      question: 'Can I require a follow to receive a reward on Instagram?',
      answer: 'Yes. With the follow gate on, Replyooo checks that the person follows your account before it sends the reward, and sends a reminder if they don’t.',
    },
    {
      question: 'Does this pick giveaway winners?',
      answer: 'No. It delivers a reward to every eligible person who comments. It doesn’t draw winners, so run any prize draw separately and follow Instagram’s promotion rules.',
    },
    CONNECT_FAQ,
    FREE_FAQ,
  ],
  related: ['send-lead-magnet-instagram', 'sell-products-from-instagram-comments', 'book-calls-from-instagram-dms'],
  updated: '2026-10-09',
}
