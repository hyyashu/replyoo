import { describe, expect, it } from 'vitest'
import { PLAN_CATALOG } from '@/lib/plans'

describe('PLAN_CATALOG', () => {
  it('derives each plan’s limits from PLAN_LIMITS', () => {
    expect(PLAN_CATALOG.map((plan) => [plan.key, plan.name, plan.price])).toEqual([
      ['free', 'Free', '$0'],
      ['pro', 'Pro', '$12'],
      ['business', 'Business', '$29'],
    ])
    expect(PLAN_CATALOG[0]?.perks.slice(0, 3)).toEqual(['1,000 contacts / month', '1 connected account', '3 live automations'])
    expect(PLAN_CATALOG[1]?.perks.slice(0, 3)).toEqual(['5,000 contacts / month', '3 connected accounts', 'Unlimited live automations'])
    expect(PLAN_CATALOG.filter((plan) => plan.featured).map((plan) => plan.key)).toEqual(['pro'])
  })
})
