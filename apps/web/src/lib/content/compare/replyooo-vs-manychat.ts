import { manychat as them } from '@/lib/content/competitors'
import { CONNECT_FAQ } from '@/lib/content/shared'
import { ours } from '@/lib/content/replyooo'
import type { ComparisonPage } from '@/lib/content/types'

export const replyoooVsManychat: ComparisonPage = {
  slug: 'replyooo-vs-manychat',
  name: 'Replyooo vs ManyChat',
  competitor: them.name,
  title: 'Replyooo vs ManyChat',
  metaTitle: 'Replyooo vs ManyChat: which Instagram DM tool fits you?',
  description:
    'ManyChat is a multi-channel chatbot platform; Replyooo focuses on Instagram comments, stories and DMs. Compare free plans, how usage is counted and who each suits.',
  lead: 'These tools overlap on Instagram but are built for different jobs. Here is where each one fits.',
  verdict: `ManyChat is a bigger platform that covers several messaging channels. Replyooo does one thing: it turns Instagram comments, story replies and DMs into automated conversations. If Instagram is your main channel, Replyooo is simpler and its free plan is bigger (${ours.freeContacts} contacts against 25). If you also need WhatsApp, SMS or a full chatbot builder, ManyChat is the better fit.`,
  rows: [
    { label: 'Built for', us: 'Instagram comments, stories and DMs, plus Facebook Pages', them: 'A chatbot platform across several messaging channels' },
    { label: 'Free plan', us: ours.free, them: them.free },
    { label: 'Paid plans', us: ours.entryPlan, them: them.entryPlan },
    { label: 'Allowance', us: ours.allowance, them: them.allowance },
    { label: 'What is counted', us: ours.meter, them: them.meter },
    { label: 'When you go over', us: ours.whenLimit, them: 'Paid plans keep running and bill an overage per extra active contact: $0.10 (Essential), $0.05 (Pro), $0.025 (Business)' },
    { label: 'Other channels', us: 'Instagram and Facebook Pages only', them: 'Free includes Instagram, Messenger, Telegram and TikTok; WhatsApp, SMS and email are on paid plans' },
  ],
  chooseThem: [
    'You message customers on WhatsApp, SMS, Messenger or Telegram as well as Instagram.',
    'You need multi-step chatbot flows or a team inbox.',
    'You already run flows in ManyChat and don’t want to rebuild them.',
  ],
  chooseUs: [
    'Instagram is your main channel and you want comment-to-DM without a flow builder.',
    `You want a bigger free plan to test on real posts (${ours.freeContacts} contacts a month).`,
    'You’d rather your automations pause at the limit than bill you extra per contact.',
  ],
  faqs: [
    {
      question: 'Is Replyooo a ManyChat alternative?',
      answer:
        'For Instagram comment-to-DM, follow gates and email capture, yes. For multi-channel chatbots, WhatsApp or SMS, no: Replyooo focuses on Instagram and Facebook Pages.',
    },
    {
      question: 'How does ManyChat count usage?',
      answer:
        'By active contacts: people who engage with you during the billing month. Replyooo counts contacts reached: a person counts once a month, the first time we message them.',
    },
    CONNECT_FAQ,
  ],
  sources: them.sources,
  checked: them.checked,
  updated: '2026-10-09',
}
