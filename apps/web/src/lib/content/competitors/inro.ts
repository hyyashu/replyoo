import type { Competitor } from '@/lib/content/types'

/** Inrō prices in euros only. Pro's price follows the contacts activated each month; only the starting price is published. */
export const inro: Competitor = {
  name: 'Inrō',
  checked: '2026-10-15',
  sources: [
    { label: 'Inrō pricing', url: 'https://www.inro.social/pricing' },
    { label: 'Inrō comment-to-DM', url: 'https://www.inro.social/product/comment-to-dm' },
  ],
  free: '100 activated contacts a month, 3 active automations',
  paid: 'Free: 100 activated contacts a month. Pro: from €12.99/month.',
  entryPlan: 'From €12.99/month (Pro), rising with contacts',
  allowance: '500+ activated contacts a month, unlimited automations, up to 10 team members',
  meter: 'Activated contacts: a person counts once a month; manual DMs don’t count',
}
