import type { Recipe } from '@/lib/recipe'

export const commentTrigger = (keyword: string): Recipe['trigger'] => ({
  type: 'comment_keyword',
  posts: { mode: 'any' },
  keywords: [keyword],
  match: 'contains',
  publicReplies: { enabled: true, replies: ['Sent! Check your DMs ✨'] },
})

export const CONNECT_FAQ = {
  question: 'Do I need a special Instagram account?',
  answer:
    'You need an Instagram Professional account (Business or Creator). Switching is free and takes a minute in the Instagram app. You connect through Meta’s official login, so Replyooo never sees your password, and you don’t need a Facebook Page.',
}

export const FREE_FAQ = {
  question: 'Is there a free plan?',
  answer: 'Yes. The free plan covers your first contacts every month with no card needed, so you can test it on your next reel. Upgrade only when it outgrows the free limit.',
}
