import { describe, expect, it } from 'vitest'
import { PLAN_LIMITS, PLAN_NAMES, effectivePlan, periodEnd, usagePeriod } from '../src'

describe('plans', () => {
  it('has a contact limit for every plan', () => {
    expect(PLAN_LIMITS.free.contactsPerMonth).toBe(1_000)
    expect(PLAN_LIMITS.pro.contactsPerMonth).toBe(5_000)
    expect(PLAN_LIMITS.business.contactsPerMonth).toBe(25_000)
  })

  it('uses UTC months for usage periods', () => {
    expect(usagePeriod(new Date('2026-12-31T23:59:59.000Z'))).toBe('2026-12')
    expect(periodEnd(new Date('2026-12-31T23:59:59.000Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z')
    expect(periodEnd(new Date('2026-10-06T10:00:00.000Z')).toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })
})

describe('effectivePlan', () => {
  const now = new Date('2026-10-06T10:00:00.000Z')
  const sub = (plan: 'free' | 'pro' | 'business', status: string, currentPeriodEnd: Date | null = null) => ({
    plan,
    status,
    currentPeriodEnd,
  })

  it('is free without a subscription', () => {
    expect(effectivePlan(null, now)).toBe('free')
    expect(effectivePlan(undefined, now)).toBe('free')
  })

  it('keeps a paid plan while active or past due', () => {
    expect(effectivePlan(sub('pro', 'active'), now)).toBe('pro')
    expect(effectivePlan(sub('business', 'past_due'), now)).toBe('business')
  })

  it('keeps a cancelled plan until the paid period ends', () => {
    expect(effectivePlan(sub('pro', 'cancelled', new Date('2026-10-20T00:00:00.000Z')), now)).toBe('pro')
    expect(effectivePlan(sub('pro', 'cancelled', new Date('2026-10-01T00:00:00.000Z')), now)).toBe('free')
    expect(effectivePlan(sub('pro', 'cancelled'), now)).toBe('free')
  })

  it('falls back to free when payment stopped', () => {
    for (const status of ['on_hold', 'paused', 'failed', 'expired', 'pending']) {
      expect(effectivePlan(sub('pro', status), now)).toBe('free')
    }
  })

  it('names every plan', () => {
    expect(PLAN_NAMES).toEqual({ free: 'Free', pro: 'Pro', business: 'Business' })
  })
})
