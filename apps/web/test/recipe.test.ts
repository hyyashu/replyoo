import { TEMPLATES, validateFlow } from '@replyooo/shared'
import { describe, expect, it } from 'vitest'
import { DEFAULT_RECIPE, changeTriggerType, compileRecipe, recipeFromFlow, type Recipe } from '@/lib/recipe'
import { checkRecipe } from '@/lib/validation'

const recipe = (patch: Partial<Recipe>): Recipe => ({ ...structuredClone(DEFAULT_RECIPE), ...patch })

describe('compileRecipe', () => {
  it('default recipe compiles to a valid comment flow', () => {
    const { issues, flow } = checkRecipe(DEFAULT_RECIPE, 'instagram')
    expect(issues).toEqual([])
    expect(flow.start).toBe('opener')
  })

  it('comment flows always get an opener with a reply button', () => {
    const flow = compileRecipe(recipe({ opener: { ...DEFAULT_RECIPE.opener, enabled: false } }))
    const opener = flow.steps[flow.start]
    expect(opener?.type).toBe('send_message')
    expect(opener?.type === 'send_message' && opener.buttons?.[0]?.type).toBe('reply')
  })

  it('dm keyword without opener starts at the delivery message', () => {
    const flow = compileRecipe(
      recipe({
        trigger: { type: 'dm_keyword', keywords: ['PRICE'], match: 'contains' },
        opener: { ...DEFAULT_RECIPE.opener, enabled: false },
      }),
    )
    expect(flow.start).toBe('deliver')
    expect(validateFlow(flow, 'facebook')).toEqual([])
  })

  it('chains opener → follow gate → collect email → deliver → tag', () => {
    const flow = compileRecipe(
      recipe({
        followGate: { ...DEFAULT_RECIPE.followGate, enabled: true },
        collect: { ...DEFAULT_RECIPE.collect, kind: 'email' },
        tags: ['email-lead'],
      }),
    )
    expect(validateFlow(flow, 'instagram')).toEqual([])
    expect(flow.steps.check).toMatchObject({ following: 'has_contact', notFollowing: 'ask_follow' })
    expect(flow.steps.has_contact).toMatchObject({ has: 'email', yes: 'deliver', no: 'ask' })
    expect(flow.steps.deliver).toMatchObject({ next: 'tag' })
  })

  it('follow gate is rejected on Facebook', () => {
    const { issues } = checkRecipe(recipe({ followGate: { ...DEFAULT_RECIPE.followGate, enabled: true } }), 'facebook')
    expect(issues).toContainEqual({ section: 'boosters', message: 'Follow checks are only available on Instagram' })
  })

  it('reports empty keywords and bad links against their sections', () => {
    const { issues } = checkRecipe(
      recipe({
        trigger: changeTriggerType(DEFAULT_RECIPE.trigger, 'dm_keyword'),
        message: { text: 'Hi', link: { enabled: true, label: 'Open', url: 'not a url' } },
      }),
      'instagram',
    )
    expect(issues).toContainEqual({ section: 'dm', message: 'Enter a valid link, including https://' })

    const empty = checkRecipe(recipe({ trigger: { type: 'dm_keyword', keywords: [], match: 'contains' } }), 'instagram')
    expect(empty.issues.map((issue) => issue.section)).toContain('trigger')
  })
})

describe('recipeFromFlow', () => {
  it.each(TEMPLATES.map((template) => [template.key, template] as const))(
    '%s round-trips into a valid flow',
    (_key, template) => {
      const platform = template.platforms[0] ?? 'instagram'
      const { issues } = checkRecipe(recipeFromFlow(template.flow), platform)
      expect(issues).toEqual([])
    },
  )

  it('recovers the boosters from the follow-gate and email templates', () => {
    const followGate = recipeFromFlow(TEMPLATES.find((t) => t.key === 'follow_gate')!.flow)
    expect(followGate.opener.enabled).toBe(true)
    expect(followGate.followGate).toMatchObject({ enabled: true, buttonLabel: 'I followed ✓' })
    expect(followGate.message.link).toMatchObject({ enabled: true, url: 'https://example.com/freebie' })

    const email = recipeFromFlow(TEMPLATES.find((t) => t.key === 'email_list')!.flow)
    expect(email.collect.kind).toBe('email')
    expect(email.tags).toEqual(['email-lead'])
  })

  it('is stable: compile(decompile(compile(r))) === compile(r)', () => {
    const original = recipe({
      followGate: { ...DEFAULT_RECIPE.followGate, enabled: true },
      collect: { ...DEFAULT_RECIPE.collect, kind: 'phone' },
      tags: ['vip'],
    })
    const flow = compileRecipe(original)
    expect(compileRecipe(recipeFromFlow(flow))).toEqual(flow)
  })
})
