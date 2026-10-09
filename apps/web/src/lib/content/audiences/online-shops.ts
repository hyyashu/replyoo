import { CONNECT_FAQ, FREE_FAQ } from '@/lib/content/shared'
import type { MarketingPage } from '@/lib/content/types'
import { DEFAULT_RECIPE } from '@/lib/recipe'

export const onlineShops: MarketingPage = {
  slug: 'online-shops',
  name: 'Online shops',
  title: 'Instagram comment automation for online shops',
  metaTitle: 'Instagram comment automation for online shops',
  description:
    'Reply to “price?” and “link?” comments with the product page, and answer shipping and order questions with conversation starters.',
  lead: 'Shoppers comment “price?” and “link?” on your reels, then ask about shipping in the DMs. Replyooo answers all of it instantly, so fewer buyers walk away.',
  recipe: {
    ...DEFAULT_RECIPE,
    trigger: {
      type: 'ice_breaker',
      items: [
        { question: 'How long is shipping?', answer: 'Orders ship within a few days. Full details are on our shipping page 👇', links: [{ label: 'Shipping info', url: 'https://example.com/shipping' }] },
        { question: 'Where is my order?', answer: 'Send your order number here and we’ll look into it.', links: [] },
        { question: 'Do you do returns?', answer: 'Yes! Here’s how returns work 👇', links: [{ label: 'Returns', url: 'https://example.com/returns' }] },
      ],
    },
  },
  mode: 'dm',
  username: 'maya.makes',
  steps: [
    { title: 'Answer the shopping comments', body: 'Send the product page to anyone who comments LINK or PRICE on a reel.' },
    { title: 'Add conversation starters', body: 'Put shipping, returns and order status in tappable questions in every new chat.' },
    { title: 'Follow up with interested shoppers', body: 'Everyone who asked is saved as a contact, with tags.' },
  ],
  points: [
    { title: 'Product links from reels', body: 'No more typing the same URL under every product video.' },
    { title: 'FAQ in the chat', body: 'Starters answer the repeated questions, so your inbox is for the real conversations.' },
    { title: 'Different link per product', body: 'Make an automation per reel, each with its own page and image.' },
    { title: 'Replies at any hour', body: 'Shoppers get an answer while they’re still looking at the product.' },
  ],
  faqs: [
    {
      question: 'How can an online shop automate Instagram replies?',
      answer: 'Use comment automations to send product links when people comment a keyword, and conversation starters to answer shipping, returns and order questions in the DMs.',
    },
    {
      question: 'Can it track orders for me?',
      answer: 'No. Replyooo sends the answers and links you write. For order lookups it can tell customers where to send their order number, but you handle the order itself.',
    },
    CONNECT_FAQ,
    FREE_FAQ,
  ],
  related: ['coaches', 'fitness-creators', 'photographers-and-freelancers'],
  updated: '2026-10-09',
}
