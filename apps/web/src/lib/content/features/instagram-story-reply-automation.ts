import { CONNECT_FAQ, FREE_FAQ } from '@/lib/content/shared'
import type { MarketingPage } from '@/lib/content/types'
import { DEFAULT_RECIPE } from '@/lib/recipe'

export const instagramStoryReplyAutomation: MarketingPage = {
  slug: 'instagram-story-reply-automation',
  name: 'Story replies',
  title: 'Instagram story reply automation',
  metaTitle: 'Instagram story reply automation',
  description:
    'Answer every story reply and reaction with an instant, personal message. Send your link or start a conversation without opening your inbox.',
  lead: 'Someone replies to your story, and Replyooo answers with the message you wrote. Work it on any story or only the ones you choose.',
  recipe: {
    ...DEFAULT_RECIPE,
    trigger: { type: 'story_reply', includeReactions: true, keywords: [], stories: { mode: 'any' }, reactWithHeart: false },
    opener: { enabled: false, text: DEFAULT_RECIPE.opener.text, buttonLabel: DEFAULT_RECIPE.opener.buttonLabel },
    message: { text: 'Thanks for the reply! 💛 Here’s the link you wanted.', imageUrl: '', links: [{ label: 'Open the link', url: 'https://example.com/link' }] },
  },
  mode: 'story',
  username: 'maya.makes',
  steps: [
    { title: 'Choose the stories', body: 'Cover every story you post, or pick specific stories to run the automation on.' },
    { title: 'Decide what counts', body: 'Answer any reply, or only replies containing a keyword. Reactions can trigger it too.' },
    { title: 'Write the answer', body: 'Send a message with up to three link buttons, and add a follow gate or email ask if you want one.' },
  ],
  points: [
    { title: 'Replies and reactions', body: 'Reactions on your story can start a conversation as well as typed replies.' },
    { title: 'Keyword or catch-all', body: 'Reply to every response, or only to the ones with the word you asked for.' },
    { title: 'Same boosters as comments', body: 'Follow gate, email capture and reminders all work on story automations.' },
    { title: 'Fits the story', body: 'Use stories for quick offers and polls, and let Replyooo handle the replies that come back.' },
  ],
  faqs: [
    {
      question: 'Can I automate replies to Instagram stories?',
      answer:
        'Yes. Replyooo can respond when someone replies to a story, and optionally when they react to it. You choose which stories it covers and what it says.',
    },
    {
      question: 'Can it reply only to certain words?',
      answer: 'Yes. Set a keyword and only replies that match it get the automatic message; leave it empty to answer every reply.',
    },
    CONNECT_FAQ,
    FREE_FAQ,
  ],
  related: ['instagram-comment-to-dm', 'instagram-follow-gate', 'instagram-dm-auto-reply'],
  updated: '2026-10-09',
}
