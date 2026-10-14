import { CONNECT_FAQ, FREE_FAQ } from '@/lib/content/shared'
import type { MarketingPage } from '@/lib/content/types'
import { DEFAULT_RECIPE } from '@/lib/recipe'

export const instagramCommentToDm: MarketingPage = {
  slug: 'instagram-comment-to-dm',
  name: 'Comment to DM',
  title: 'Instagram comment-to-DM automation',
  metaTitle: 'Instagram comment-to-DM automation',
  description:
    'Send your link to everyone who comments a keyword on your Instagram reel or post. Reply publicly and in their DMs at the same time, with no coding.',
  lead: 'Fans comment a word like GUIDE or LINK, and Replyooo replies on the post and sends them your link in a DM. Set it up once and it runs on every reel.',
  recipe: {
    ...DEFAULT_RECIPE,
    trigger: {
      type: 'comment_keyword',
      posts: { mode: 'any' },
      keywords: ['GUIDE'],
      match: 'contains',
      publicReplies: { enabled: true, replies: ['Sent! Check your DMs ✨'] },
    },
    opener: { enabled: true, text: 'Hey {{first_name}}! Want my 7-day meal plan? Tap below 👇', buttonLabel: 'Send it to me' },
    message: {
      text: "Here you go! 🎉 Save it so you don't lose it.",
      imageUrl: '',
      links: [{ label: 'Get the guide', url: 'https://example.com/guide' }],
    },
  },
  mode: 'comment',
  username: 'maya.makes',
  steps: [
    { title: 'Pick the keyword', body: 'Choose the word your followers comment, and whether it must match exactly or can appear inside a longer comment.' },
    { title: 'Choose the posts', body: 'Run it on every post and reel, or only on the specific ones where you ask people to comment.' },
    { title: 'Write the reply and the DM', body: 'Add a public reply (or a few to rotate) and the message with your link. Replyooo does the rest.' },
  ],
  points: [
    { title: 'A public reply and a DM in one go', body: 'The comment gets a visible reply, so the post looks alive, while the link goes to their inbox.' },
    { title: 'Rotating public replies', body: 'Add several reply variations so a busy reel doesn’t fill up with the same sentence.' },
    { title: 'Personal by name', body: 'Use the commenter’s first name in the opening message so it reads like you, not a bot.' },
    { title: 'Tags every contact', body: 'Everyone who comments is saved as a contact, with tags you choose, so you can see who asked for what.' },
  ],
  faqs: [
    {
      question: 'How does Instagram comment-to-DM automation work?',
      answer:
        'You choose a keyword and the posts it applies to. When someone comments that keyword, Replyooo replies to the comment and sends them a DM with your link or message, usually within seconds.',
    },
    {
      question: 'Why does the first message have a button?',
      answer:
        'Instagram allows one private message in reply to a comment until the person responds. The first DM carries a button; when they tap it, Replyooo delivers the link, and can also run a follow check or ask for an email first.',
    },
    CONNECT_FAQ,
    FREE_FAQ,
  ],
  related: ['instagram-follow-gate', 'collect-emails-instagram-dm', 'instagram-story-reply-automation'],
  updated: '2026-10-09',
}
