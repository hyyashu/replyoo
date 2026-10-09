import type { Competitor } from '@/lib/content/types'

/**
 * Paid prices are left out on purpose: ManyChat's own pricing page blocks automated reads and third-party sources
 * disagreed ($14 or $17 for Essential, for example). Add the price to `entryPlan` and `paid` once it is confirmed.
 * The limits below come from ManyChat's help center.
 */
export const manychat: Competitor = {
  name: 'ManyChat',
  checked: '2026-10-09',
  sources: [
    { label: 'ManyChat help center: Free plan', url: 'https://help.manychat.com/hc/en-us/articles/25800197498652-Free-plan' },
    { label: 'ManyChat help center: Active Contacts', url: 'https://help.manychat.com/hc/en-us/articles/25800323349020-Active-Contacts' },
  ],
  free: '25 active contacts a month, up to 4 live automations at once, 1 user',
  paid: 'Free: 25 active contacts a month. Paid plans scale by active contacts, from 250 to 25,000.',
  entryPlan: 'Paid plans start at 250 active contacts a month',
  allowance: 'Tiers of 250, 2,500, 7,500 and 25,000 active contacts a month',
  meter: 'Active contacts: people who engage with you in the billing month',
}
