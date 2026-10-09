import { creatorflow, instantdm, manychat, replyrush } from '@/lib/content/competitors'
import { CONNECT_FAQ } from '@/lib/content/shared'
import { ours } from '@/lib/content/replyooo'
import type { AlternativesPage } from '@/lib/content/types'

export const manychatAlternatives: AlternativesPage = {
  slug: 'manychat-alternatives',
  name: 'ManyChat alternatives',
  competitor: manychat.name,
  title: 'ManyChat alternatives for Instagram comment-to-DM',
  metaTitle: 'ManyChat alternatives for Instagram comment-to-DM',
  description:
    'Looking for a ManyChat alternative for Instagram? Compare simpler, Instagram-focused tools for comment-to-DM, follow gates and lead capture.',
  lead: 'ManyChat is the best-known chatbot platform, built to cover several channels. If you mainly want Instagram comments turned into DMs, a smaller Instagram-focused tool can be simpler and cheaper. Here are the options, and when to stay with ManyChat.',
  reasons: [
    {
      title: 'The free plan is small',
      body: 'ManyChat’s Free plan covers 25 active contacts a month and up to four live automations at once. Its pricing changed on 2 March 2026 from a 1,000-contact cap to monthly active contacts.',
    },
    {
      title: 'Paid plans scale with active contacts',
      body: 'Paid tiers cover 250, 2,500, 7,500 or 25,000 active contacts a month, with an overage charge per extra contact. A post that goes viral raises the bill.',
    },
    {
      title: 'It is built for more than Instagram',
      body: 'ManyChat covers channels such as Messenger, WhatsApp, SMS and Telegram. If you only post on Instagram, you are paying for breadth you may not use.',
    },
  ],
  options: [
    {
      name: 'Replyooo',
      us: true,
      compareSlug: 'replyooo-vs-manychat',
      bestFor: 'Creators who want comment-to-DM, a follow gate and email capture without learning a flow builder.',
      summary: 'Instagram-focused. Set a keyword, write the DM once, and add a follow gate or email question. We make this tool, so read our claims with that in mind.',
      pricing: ours.paid,
    },
    {
      name: creatorflow.name,
      compareSlug: 'replyooo-vs-creatorflow',
      bestFor: 'People who want link click tracking and DM top-up packs.',
      summary: 'Instagram comment-to-DM with a flat rate and no per-contact fees. Follow gate and email gate are on the paid plans.',
      pricing: creatorflow.paid,
    },
    {
      name: instantdm.name,
      compareSlug: 'replyooo-vs-instantdm',
      bestFor: 'Budget-minded creators with one account.',
      summary: 'Instagram automation with no per-contact fees. Email collection is on paid plans; the follow gate is only listed on its multi-account plans.',
      pricing: instantdm.paid,
    },
    {
      name: replyrush.name,
      compareSlug: 'replyooo-vs-replyrush',
      bestFor: 'Higher DM volumes on a budget.',
      summary: 'A large free DM allowance and a low-priced entry plan. Comment auto-reply, follow-gated DMs and an email collector are not on Free.',
      pricing: replyrush.paid,
    },
  ],
  stayWith: [
    'You message customers on WhatsApp, SMS, Messenger or Telegram as well as Instagram.',
    'You need a multi-step chatbot with AI replies and a shared inbox for a team.',
    'You already have flows in ManyChat that you do not want to rebuild.',
  ],
  faqs: [
    {
      question: 'What is a good free alternative to ManyChat for Instagram?',
      answer: `Several tools have free plans: ManyChat itself (25 active contacts), Replyooo (${ours.freeContacts} contacts a month), CreatorFlow (500 DMs), InstantDM (500 automations) and ReplyRush (1,500 DMs). They count usage differently, so test on a real post before choosing.`,
    },
    {
      question: 'Do these tools use Instagram’s official API?',
      answer: 'Replyooo connects through Meta’s official login. For the others, check each tool’s own site; this page does not verify how they connect.',
    },
    CONNECT_FAQ,
  ],
  sources: [...manychat.sources, ...creatorflow.sources, ...instantdm.sources, ...replyrush.sources],
  checked: '2026-10-09',
  updated: '2026-10-09',
}
