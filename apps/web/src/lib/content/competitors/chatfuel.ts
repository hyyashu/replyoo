import type { Competitor } from '@/lib/content/types'

/**
 * Only chatfuel.com/pricing and its limits page are used. Older Chatfuel pricing pages (a free tier, per-conversation
 * plans) still turn up in search and disagree with them, so don't take facts from those.
 */
export const chatfuel: Competitor = {
  name: 'Chatfuel',
  checked: '2026-10-15',
  sources: [
    { label: 'Chatfuel pricing', url: 'https://www.chatfuel.com/pricing' },
    { label: 'Chatfuel plan limits', url: 'https://limits.chatfuel.com/en' },
    { label: 'Chatfuel for Instagram', url: 'https://www.chatfuel.com/instagram' },
  ],
  free: 'No free plan listed; every plan starts with a free trial',
  paid: 'Business: $18/month billed yearly ($216/year).',
  entryPlan: '$18/month billed yearly (Business)',
  allowance: 'Unlimited active contacts and non-AI automations, $20 of AI credits a month',
  meter: 'AI usage; keyword replies, button flows and other non-AI automation are unlimited',
}
