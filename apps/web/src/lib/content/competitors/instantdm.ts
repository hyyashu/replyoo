import type { Competitor } from '@/lib/content/types'

export const instantdm: Competitor = {
  name: 'InstantDM',
  checked: '2026-10-09',
  sources: [{ label: 'InstantDM pricing', url: 'https://instantdm.com/pricing' }],
  free: '500 DM automations a month, 3 trigger words, 1 account',
  paid: 'Free: 500 automations a month. Legend Pro: $9.99/month billed yearly.',
  entryPlan: '$9.99/month, billed yearly (Legend Pro)',
  allowance: 'Unlimited automations up to 800 an hour, 1 Instagram account, no per-contact fees',
  meter: 'Automations sent, with an hourly cap on single-account plans; no per-contact fees',
}
