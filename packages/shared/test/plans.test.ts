import { describe, expect, it } from 'vitest'
import { PLAN_LIMITS, periodEnd, usagePeriod } from '../src'

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
