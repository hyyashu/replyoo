import { TEMPLATES } from '@replyooo/shared'
import { describe, expect, it } from 'vitest'
import * as data from '@/lib/data'
import { DEFAULT_RECIPE, compileRecipe } from '@/lib/recipe'

describe('publishAutomation', () => {
  it.each(TEMPLATES.map((t) => [t.key] as const))('a fresh %s draft publishes on Instagram', async (key) => {
    const automation = await data.createAutomation('acc_ig', key)
    expect(await data.publishAutomation(automation.id)).toEqual({ ok: true, version: 1 })
    expect((await data.getAutomation(automation.id))?.status).toBe('active')
  })

  it('rejects a follow gate on a Facebook Page server-side', async () => {
    const automation = await data.createAutomation('acc_fb', null)
    await data.saveDraft(automation.id, {
      name: 'Gate',
      flow: compileRecipe({ ...DEFAULT_RECIPE, followGate: { ...DEFAULT_RECIPE.followGate, enabled: true } }),
    })
    const result = await data.publishAutomation(automation.id)
    expect(result).toEqual({ ok: false, errors: ['Follow checks are only available on Instagram'] })
    expect((await data.getAutomation(automation.id))?.status).toBe('draft')
  })

  it('rejects a comment flow whose first message has no reply button', async () => {
    const automation = await data.createAutomation('acc_ig', 'comment_to_dm')
    const flow = structuredClone(automation.flow)
    flow.start = 'link'
    delete flow.steps.opener
    await data.saveDraft(automation.id, { name: 'Broken', flow })
    const result = await data.publishAutomation(automation.id)
    expect(result.ok).toBe(false)
  })
})

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
