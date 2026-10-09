import { replyrush as them } from '@/lib/content/competitors'
import { CONNECT_FAQ } from '@/lib/content/shared'
import { ours } from '@/lib/content/replyooo'
import type { ComparisonPage } from '@/lib/content/types'

export const replyoooVsReplyrush: ComparisonPage = {
  slug: 'replyooo-vs-replyrush',
  name: 'Replyooo vs ReplyRush',
  competitor: them.name,
  title: 'Replyooo vs ReplyRush',
  metaTitle: 'Replyooo vs ReplyRush: Instagram DM automation compared',
  description:
    'Replyooo and ReplyRush both automate Instagram comment-to-DM. Compare free plans, paid pricing, follow gate, email capture and branding removal.',
  lead: 'Two tools aimed at creators who want comment-to-DM without a complicated builder. Here is how they compare.',
  verdict: `ReplyRush has the larger free DM allowance and a cheaper entry plan ($10 against our ${ours.proPrice}) with a bigger monthly DM limit. Replyooo includes public comment replies on every plan and removes branding on Pro, where ReplyRush lists branding removal and comment auto-reply from its $25 Boost plan.`,
  rows: [
    { label: 'Free plan', us: ours.free, them: them.free },
    { label: 'Entry paid plan', us: ours.entryPlan, them: them.entryPlan },
    { label: 'Allowance on that plan', us: ours.allowance, them: them.allowance },
    { label: 'What is counted', us: ours.meter, them: them.meter },
    { label: 'Follow gate', us: 'Pro and up', them: 'Lite and up' },
    { label: 'Email capture', us: 'Pro and up', them: 'Lite and up' },
    { label: 'Public comment replies', us: 'All plans', them: 'Listed as “comment auto-reply”, on Boost and up' },
    { label: 'Branding removal', us: 'Pro and up', them: 'Boost and up' },
    { label: 'When the allowance runs out', us: ours.whenLimit, them: 'An excess-DM queue is not included on its Free plan' },
  ],
  chooseThem: [
    'You need a high DM allowance on a budget: 7,500 DMs a month for $10.',
    'You want the biggest free plan, at 1,500 DMs a month.',
    'You mainly want volume, with 40,000 DMs a month on its $25 Boost plan.',
  ],
  chooseUs: [
    'You want public comment replies on the free plan.',
    'You want branding gone without paying for a $25 plan.',
    'You run several accounts and want 3 on one paid plan.',
  ],
  faqs: [
    {
      question: 'Is ReplyRush cheaper than Replyooo?',
      answer: `Its Lite plan is $10/month against ${ours.proPrice}/month for our Pro, and it allows more DMs. Lite doesn’t list branding removal or comment auto-reply, which are on the $25 Boost plan.`,
    },
    {
      question: 'Which free plan is better?',
      answer: `ReplyRush’s is bigger at 1,500 DMs a month, but its pricing page lists no comment auto-reply, follow gate or email collector on Free. Replyooo’s Free covers ${ours.freeContacts} contacts a month with public comment replies.`,
    },
    CONNECT_FAQ,
  ],
  sources: them.sources,
  checked: them.checked,
  updated: '2026-10-09',
}
