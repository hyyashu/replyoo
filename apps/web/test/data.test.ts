import { describe, expect, it } from 'vitest'
import * as data from '@/lib/data'

describe('listContacts', () => {
  it('filters by search, tag and lead type', async () => {
    const all = await data.listContacts('acc_ig')
    const withPhone = await data.listContacts('acc_ig', { has: 'phone' })
    expect(withPhone.length).toBeGreaterThan(0)
    expect(withPhone.every((c) => c.phone)).toBe(true)
    expect(withPhone.length).toBeLessThan(all.length)
    expect(await data.listContacts('acc_ig', { q: 'SAM.EATS' })).toHaveLength(1)
    expect((await data.listContacts('acc_ig', { tag: 'vip' })).every((c) => c.tags.includes('vip'))).toBe(true)
  })
})
