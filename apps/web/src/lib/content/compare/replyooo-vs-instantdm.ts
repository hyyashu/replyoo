import { instantdm as them } from '@/lib/content/competitors'
import { CONNECT_FAQ } from '@/lib/content/shared'
import { ours } from '@/lib/content/replyooo'
import type { ComparisonPage } from '@/lib/content/types'

export const replyoooVsInstantdm: ComparisonPage = {
  slug: 'replyooo-vs-instantdm',
  name: 'Replyooo vs InstantDM',
  competitor: them.name,
  title: 'Replyooo vs InstantDM',
  metaTitle: 'Replyooo vs InstantDM: Instagram DM automation compared',
  description:
    'Replyooo and InstantDM both automate Instagram comment replies and DMs. Compare free plans, paid pricing, follow gate, email capture and limits.',
  lead: 'Two Instagram-focused tools with free plans. Here is how their pricing, limits and features compare.',
  verdict: `InstantDM’s entry paid plan is cheaper per month if you pay yearly ($9.99 against our ${ours.proPrice}), and it has no per-contact fees. Replyooo gives you the follow gate and email capture on its entry paid plan, a bigger free plan, and month-to-month pricing. InstantDM’s pricing page lists the follow gate only on its multi-account plans.`,
  rows: [
    { label: 'Free plan', us: ours.free, them: them.free },
    { label: 'Entry paid plan', us: ours.entryPlan, them: them.entryPlan },
    { label: 'Allowance on that plan', us: ours.allowance, them: them.allowance },
    { label: 'What is counted', us: ours.meter, them: them.meter },
    { label: 'Follow gate', us: 'Pro and up', them: 'Listed on its multi-account plans' },
    { label: 'Email capture', us: 'Pro and up', them: 'Paid plans' },
    { label: 'Story reply automation', us: 'All plans', them: 'Paid plans' },
    { label: 'Several accounts', us: `${ours.proAccounts} accounts on Pro`, them: 'Multi plans: 3 accounts billed at $160 a year, or 10 at $990 a year' },
    { label: 'Branding on messages', us: 'Removed on Pro and up', them: 'Applies on Free; removal is listed on its multi-account plans' },
  ],
  chooseThem: [
    'You want the lowest monthly price and are happy to pay for a year up front.',
    'You manage several accounts and want the per-account Multi pricing.',
    'You want no monthly cap on automations, only an hourly limit.',
  ],
  chooseUs: [
    'You want the follow gate and email capture on the entry paid plan.',
    'You want story reply automation on the free plan.',
    `You’d like a bigger free plan (${ours.freeContacts} contacts a month) and to pay month to month.`,
  ],
  faqs: [
    {
      question: 'Which is cheaper, Replyooo or InstantDM?',
      answer: `InstantDM’s Legend Pro is $9.99/month billed yearly, against ${ours.proPrice}/month for Replyooo Pro. The plans include different features, so compare what you need: the follow gate, for example, is on our Pro plan.`,
    },
    {
      question: 'Do both have a free plan?',
      answer: `Yes. Replyooo’s covers ${ours.freeContacts} contacts a month with story replies included. InstantDM’s covers 500 automations a month and doesn’t include email collection or story replies.`,
    },
    CONNECT_FAQ,
  ],
  sources: them.sources,
  checked: them.checked,
  updated: '2026-10-09',
}
