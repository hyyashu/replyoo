import type { ToolPage } from '@/lib/content/types'

export const instagramEngagementRateCalculator: ToolPage = {
  slug: 'instagram-engagement-rate-calculator',
  name: 'Engagement rate calculator',
  tool: 'engagement',
  title: 'Instagram engagement rate calculator',
  metaTitle: 'Instagram engagement rate calculator — free',
  description:
    'Work out your Instagram engagement rate from followers, likes, comments, saves and shares on your recent posts. Free, no login, nothing to connect.',
  lead: 'Enter your follower count and the numbers from a few recent posts. You get the engagement rate by followers and the average interactions per post.',
  steps: [
    { title: 'Add your followers', body: 'Your current follower count, from your profile.' },
    { title: 'Add recent posts', body: 'Likes and comments for each post; saves and shares too if you have them from Insights.' },
    { title: 'Read the rate', body: 'Average interactions per post divided by followers. Compare it with your own earlier posts.' },
  ],
  pitch: {
    title: 'Turn comments into conversations',
    body: 'Comments are the interaction that leads somewhere. With Replyooo, a comment like GUIDE gets a DM with your link, and a public reply that keeps the post active.',
    href: '/features/instagram-comment-to-dm',
    cta: 'See comment-to-DM',
  },
  faqs: [
    {
      question: 'How is engagement rate calculated?',
      answer:
        'This tool uses engagement by followers: add up likes, comments, saves and shares on each post, average them across the posts you entered, then divide by your follower count.',
    },
    {
      question: 'What is a good engagement rate?',
      answer:
        'Published benchmarks disagree, because each one uses its own formula and sample of accounts, and smaller accounts usually score higher. Your own trend is a better guide: work out the rate for this month and last month the same way and compare.',
    },
    {
      question: 'Should I include saves and shares?',
      answer:
        'If you have them. They show up only in your own Insights, so you can’t include them for someone else’s account. Either way, use the same fields every time you compare.',
    },
    {
      question: 'Do you need my login?',
      answer: 'No. You type the numbers in; nothing is connected and nothing leaves your browser.',
    },
  ],
  related: ['instagram-character-counter', 'utm-link-builder'],
  updated: '2026-10-15',
}
