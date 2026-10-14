import { chatfuel, creatorflow, inro, instantdm, linkdm, manychat, replyrush } from '@/lib/content/competitors'
import { ours } from '@/lib/content/replyooo'
import { CONNECT_FAQ } from '@/lib/content/shared'
import type { BestPage } from '@/lib/content/types'

const competitors = [manychat, linkdm, inro, creatorflow, instantdm, replyrush, chatfuel]

export const bestInstagramDmAutomationTools: BestPage = {
  slug: 'instagram-dm-automation-tools',
  name: 'Best Instagram DM automation tools',
  title: 'The best Instagram DM automation tools in 2026',
  metaTitle: 'Best Instagram DM automation tools in 2026, compared',
  description:
    'Eight Instagram DM automation tools compared on free plans, prices, what they count and comment-to-DM features, with who each one suits and where it falls short.',
  lead: 'Eight tools that send automatic Instagram DMs when people comment, reply to a story or message you. They differ most in what they count, which features sit on the free plan, and whether Instagram is their only channel. Here is who each one suits.',
  method: [
    'We read each tool’s own pricing and feature pages, not review sites, and list the date we checked. Prices are in the currency each tool shows.',
    'We compared the free plan, the cheapest paid plan, what each tool counts (contacts, DMs or AI use) and where the main Instagram features sit: comment-to-DM, follow gate, email capture and story replies.',
    'Every tool has a “watch out for” list, ours included.',
    'We make Replyooo. It’s listed first because it’s ours, not because of a test against the others. We haven’t run the other tools on a live account for this page.',
  ],
  picks: [
    {
      name: 'Replyooo',
      us: true,
      bestFor: 'Creators who want comment-to-DM, a follow gate and email capture without a flow builder.',
      summary:
        'Instagram-focused, with Facebook Pages too. You pick a keyword, write the DM, and add a follow gate, an email question or a reminder. Each person counts once a month however many messages they get.',
      free: ours.free,
      entryPlan: ours.entryPlan,
      meter: ours.meter,
      strengths: [
        'Public comment replies and story reply automation on the free plan.',
        'Link click tracking per automation on every plan.',
        `${ours.proAccounts} accounts and no branding on the ${ours.proPrice} plan.`,
      ],
      watchOut: [
        'Follow gate and email capture need the paid plan.',
        'Instagram and Facebook only: no WhatsApp, SMS or TikTok.',
        'No AI replies and no shared team inbox yet.',
      ],
    },
    {
      name: manychat.name,
      compareSlug: 'replyooo-vs-manychat',
      bestFor: 'Businesses that message customers on several channels and want a full chatbot builder.',
      summary:
        'The best-known chatbot platform. It covers Instagram, Messenger, Telegram and TikTok on its free plan, with WhatsApp, SMS and email on paid plans, and builds multi-step flows.',
      free: manychat.free,
      entryPlan: manychat.entryPlan,
      meter: manychat.meter,
      strengths: ['Many channels in one tool.', 'Multi-step flows, AI replies and a team inbox.'],
      watchOut: ['The free plan covers 25 active contacts a month.', 'Paid plans bill an overage for each contact over the tier, so a viral post raises the bill.'],
    },
    {
      name: linkdm.name,
      bestFor: 'High DM volumes across up to three accounts.',
      summary:
        'Instagram and Facebook automation from a company that describes itself as a Meta Business Partner. Its Pro plan has a large DM allowance and extras such as IG Live automation and backsending DMs (“Rewind”).',
      free: linkdm.free,
      entryPlan: linkdm.entryPlan,
      meter: linkdm.meter,
      strengths: ['25,000 DMs a month on Pro.', 'Story automations on the free plan.', 'Extras such as IG Live automation and reminder DMs on Pro.'],
      watchOut: [
        'Comment auto-reply, the follow tool and email collection are listed on Pro, not Free.',
        'Its help docs say the follow check sends the DM anyway after a few retries, so it isn’t a strict gate.',
      ],
    },
    {
      name: inro.name,
      bestFor: 'Instagram businesses that want a built-in CRM and pay as they grow.',
      summary:
        'Instagram only, from a company that describes itself as a Meta Tech Provider. Comment-to-DM is on every plan, with a contact list, segments and an AI agent on top.',
      free: inro.free,
      entryPlan: inro.entryPlan,
      meter: inro.meter,
      strengths: ['Comment-to-DM on the free plan.', 'A CRM with segments; webhooks and an API on Pro.', 'Shows who clicked your link and who didn’t.'],
      watchOut: ['Priced in euros, and the Pro price rises with the contacts you activate.', 'The free plan covers 100 contacts a month.'],
    },
    {
      name: creatorflow.name,
      compareSlug: 'replyooo-vs-creatorflow',
      bestFor: 'Creators who want geo analytics on link clicks and DM top-up packs.',
      summary: 'Instagram comment-to-DM with a flat monthly price and no per-contact fees. Story replies are on every plan.',
      free: creatorflow.free,
      entryPlan: creatorflow.entryPlan,
      meter: creatorflow.meter,
      strengths: ['Click and geo analytics on paid plans.', 'One-time DM top-up packs when you go over.', 'Unlimited active automations on the free plan.'],
      watchOut: ['Counts every DM, so multi-message flows use the allowance faster.', 'Follow gate and email capture need the paid plan.'],
    },
    {
      name: instantdm.name,
      compareSlug: 'replyooo-vs-instantdm',
      bestFor: 'The lowest price for one account, paid yearly.',
      summary: 'Instagram automation with no per-contact fees and an hourly cap instead of a monthly one on its paid plan.',
      free: instantdm.free,
      entryPlan: instantdm.entryPlan,
      meter: instantdm.meter,
      strengths: ['$9.99/month when billed yearly.', 'No monthly cap on automations on Legend Pro, only an hourly limit.'],
      watchOut: ['Its pricing page lists the follow gate only on multi-account plans.', 'Email collection and story replies aren’t on the free plan.'],
    },
    {
      name: replyrush.name,
      compareSlug: 'replyooo-vs-replyrush',
      bestFor: 'A large free DM allowance and cheap volume.',
      summary: 'Instagram and Facebook automation with a generous free plan and a low-priced entry plan.',
      free: replyrush.free,
      entryPlan: replyrush.entryPlan,
      meter: replyrush.meter,
      strengths: ['1,500 DMs a month free.', 'Follow gate and email capture from the $10 plan.', '7,500 DMs a month on that plan.'],
      watchOut: ['Comment auto-reply and branding removal are listed from the $25 Boost plan.'],
    },
    {
      name: chatfuel.name,
      bestFor: 'Businesses selling over WhatsApp and Instagram, with AI agents.',
      summary:
        'A chatbot platform for WhatsApp, Instagram, Facebook, TikTok and website chat, from a company that describes itself as an official Meta partner. Plans include AI credits; non-AI automation is unlimited.',
      free: chatfuel.free,
      entryPlan: chatfuel.entryPlan,
      meter: chatfuel.meter,
      strengths: ['Unlimited contacts and non-AI automations.', 'WhatsApp campaigns and Meta Pixel conversion tracking.', 'AI agents for qualifying leads.'],
      watchOut: ['No free plan, only a trial.', 'The listed price is billed yearly.', 'A follow gate isn’t listed on its Instagram page.'],
    },
  ],
  faqs: [
    {
      question: 'Is it allowed to automate Instagram DMs?',
      answer:
        'Yes, through Meta’s official messaging API, which has its own rules, such as only messaging people who contacted you first and replying within 24 hours. Replyooo uses it, and LinkDM, Inrō and Chatfuel say on their sites that they do. Check any tool’s site before connecting your account.',
    },
    {
      question: 'Which tool has the best free plan?',
      answer: `It depends on what is counted. ReplyRush gives 1,500 DMs, LinkDM 1,000 DMs, Replyooo ${ours.freeContacts} contacts, CreatorFlow and InstantDM 500 DMs or automations, Inrō 100 contacts and ManyChat 25 contacts. A contact can get several messages; a DM is one message. Chatfuel has a trial instead.`,
    },
    {
      question: 'Contacts or DMs: which pricing is better?',
      answer:
        'If your flows send several messages per person (a link, then a reminder, then an email question), contact-based pricing goes further. If you send one DM per comment, DM-based allowances are easy to compare. Tools that bill overages can cost more after a viral post; tools that pause at the limit don’t.',
    },
    CONNECT_FAQ,
  ],
  sources: competitors.flatMap((c) => c.sources),
  checked: competitors.map((c) => c.checked).sort()[0]!,
  updated: '2026-10-15',
}
