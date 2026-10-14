import { CONNECT_FAQ, FREE_FAQ } from '@/lib/content/shared'
import type { MarketingPage } from '@/lib/content/types'
import { DEFAULT_RECIPE } from '@/lib/recipe'

export const sellProductsFromInstagramComments: MarketingPage = {
  slug: 'sell-products-from-instagram-comments',
  name: 'Product links',
  title: 'Send product links to everyone who comments',
  metaTitle: 'Send product links from Instagram comments',
  description:
    'Comment “LINK” or “PRICE” and get the product page in the DM. Replyooo answers shopping comments on your reels and posts without you typing each link.',
  lead: 'When a reel shows a product, the comments fill up with “link?” and “price?”. Replyooo sends each person the product page, so the question never goes unanswered.',
  recipe: {
    ...DEFAULT_RECIPE,
    trigger: {
      type: 'comment_keyword',
      posts: { mode: 'any' },
      keywords: ['LINK', 'PRICE'],
      match: 'contains',
      publicReplies: { enabled: true, replies: ['Sent it to your DMs 📩', 'Check your DMs! ✨'] },
    },
    opener: { enabled: true, text: 'Hey {{first_name}}! Tap below for the link and price 👇', buttonLabel: 'Show me' },
    message: { text: 'Here it is! 🛍️ Let me know if you have any questions.', imageUrl: '', links: [{ label: 'View the product', url: 'https://example.com/product' }] },
  },
  mode: 'comment',
  username: 'maya.makes',
  steps: [
    { title: 'Choose the words people comment', body: 'Add the keywords your audience already uses, like LINK, PRICE or SHOP.' },
    { title: 'Link the product', body: 'Send the page for that reel, with an image and up to three link buttons.' },
    { title: 'Let it answer each reel', body: 'Run it on every post, or set up a different link for each product post.' },
  ],
  points: [
    { title: 'Several keywords', body: 'One automation can answer LINK, PRICE and SHOP, so you catch the different ways people ask.' },
    { title: 'A different link per post', body: 'Create one automation per product reel, each pointing to its own page.' },
    { title: 'Images in the DM', body: 'Attach a product photo that is sent just before the message with the link.' },
    { title: 'Know who asked', body: 'Everyone who comments is saved as a contact, so you can follow up with the people who showed interest.' },
  ],
  faqs: [
    {
      question: 'Can I send a product link when someone comments on my Instagram reel?',
      answer: 'Yes. Set a keyword such as LINK, choose the reel, and write the DM with the product page. Replyooo sends it to everyone who comments that keyword.',
    },
    {
      question: 'Can I use a different link for each reel?',
      answer: 'Yes. Make one automation per post and choose that post in the trigger. Each one can send its own message, image and link.',
    },
    CONNECT_FAQ,
    FREE_FAQ,
  ],
  related: ['send-lead-magnet-instagram', 'grow-followers-with-giveaways', 'book-calls-from-instagram-dms'],
  updated: '2026-10-09',
}
