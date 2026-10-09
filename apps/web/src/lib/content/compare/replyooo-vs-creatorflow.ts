import { creatorflow as them } from '@/lib/content/competitors'
import { CONNECT_FAQ } from '@/lib/content/shared'
import { ours } from '@/lib/content/replyooo'
import type { ComparisonPage } from '@/lib/content/types'

export const replyoooVsCreatorflow: ComparisonPage = {
  slug: 'replyooo-vs-creatorflow',
  name: 'Replyooo vs CreatorFlow',
  competitor: them.name,
  title: 'Replyooo vs CreatorFlow',
  metaTitle: 'Replyooo vs CreatorFlow: Instagram DM automation compared',
  description:
    'Replyooo and CreatorFlow both turn Instagram comments into DMs. Compare free plans, paid pricing, follow gate, email capture and how each one counts usage.',
  lead: 'Both tools send a DM to everyone who comments a keyword on your Instagram posts. Here is how the plans, limits and features line up.',
  verdict: `The two are close. Both are Instagram-focused, both have a free plan, and both put the follow gate and email capture on the paid plans. Replyooo’s Pro is ${ours.proPrice}/month with ${ours.proContacts} contacts and ${ours.proAccounts} accounts. CreatorFlow’s Pro is $15/month (or $12 billed annually) with 5,000 DMs and 2 accounts. The main difference is how usage is counted, and how many accounts and extras you get for the price.`,
  rows: [
    { label: 'Free plan', us: ours.free, them: them.free },
    { label: 'Entry paid plan', us: ours.entryPlan, them: them.entryPlan },
    { label: 'Allowance on that plan', us: ours.allowance, them: them.allowance },
    { label: 'What is counted', us: ours.meter, them: them.meter },
    { label: 'Follow gate', us: 'Pro and up', them: 'Pro and up' },
    { label: 'Email capture', us: 'Pro and up', them: 'Pro and up' },
    { label: 'Story reply automation', us: 'All plans', them: 'All plans' },
    { label: 'CSV export of contacts', us: 'Yes', them: 'Pro and up' },
    { label: 'When the allowance runs out', us: ours.whenLimit, them: 'Automations pause until the next billing cycle or you upgrade; one-time DM top-up packs are available on paid plans' },
    { label: 'Link click tracking and geo analytics', us: 'Not on DM links (click stats are on bio page links only)', them: 'Pro and up' },
  ],
  chooseThem: [
    'You want link click tracking and geo analytics on your DM links.',
    'You like buying one-time DM top-up packs that never expire when you go over.',
    'You want a paid-annual discount, which brings their Pro to $12/month.',
  ],
  chooseUs: [
    'You get several DMs per person, since we count each contact once a month however many messages they get.',
    'You run more than two accounts and want 3 on the entry paid plan.',
    `You want a larger free plan (${ours.freeContacts} contacts a month) to test properly.`,
  ],
  faqs: [
    {
      question: 'Is Replyooo cheaper than CreatorFlow?',
      answer: `On monthly billing, yes: Pro is ${ours.proPrice}/month against CreatorFlow’s $15/month. If you pay CreatorFlow annually it is $12/month, which matches. Check the allowance too, since we count contacts and they count DMs.`,
    },
    {
      question: 'Do contacts and DMs mean the same thing?',
      answer:
        'No. A contact is one person, counted once a month however many messages they receive. A DM limit counts every message. A flow that sends three messages to each person uses three DMs but one contact.',
    },
    CONNECT_FAQ,
  ],
  sources: them.sources,
  checked: them.checked,
  updated: '2026-10-09',
}
