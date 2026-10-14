import { TEMPLATES, validateFlow } from '@replyooo/shared'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RECIPE,
  addChips,
  changeTriggerType,
  compileRecipe,
  EMPTY_CARD,
  recipeFromFlow,
  setCollectKind,
  type Recipe,
} from '@/lib/recipe'
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

  it('adds https:// to a link typed without a scheme, so it passes validation and is saved with it', () => {
    const typed = recipe({
      message: {
        format: 'links',
        cards: [],
        text: 'Hi',
        imageUrl: ' cdn.example.com/pic.png ',
        links: [
          { label: 'Bare', url: 'example.com' },
          { label: 'Path', url: ' www.example.com/a?b=1#c ' },
          { label: 'Slashes', url: '//example.com/x' },
        ],
      },
    })
    const { flow, issues } = checkRecipe(typed, 'instagram')
    expect(issues).toEqual([])
    const deliver = flow.steps.deliver
    expect(deliver?.type === 'send_message' && deliver.imageUrl).toBe('https://cdn.example.com/pic.png')
    expect(deliver?.type === 'send_message' && deliver.buttons?.map((b) => b.type === 'url' && b.url)).toEqual([
      'https://example.com',
      'https://www.example.com/a?b=1#c',
      'https://example.com/x',
    ])
  })

  it('leaves a link that already has http:// or https:// exactly as typed', () => {
    const { flow, issues } = checkRecipe(
      recipe({ message: { format: 'links', cards: [], text: 'Hi', imageUrl: '', links: [{ label: 'Open', url: 'http://example.com' }] } }),
      'instagram',
    )
    expect(issues).toEqual([])
    const deliver = flow.steps.deliver
    expect(deliver?.type === 'send_message' && deliver.buttons?.[0]).toMatchObject({ url: 'http://example.com' })
  })

  it('still rejects text that is not a web address, even though bare domains are now accepted', () => {
    for (const url of ['not a url', 'hello', 'javascript:alert(1)', 'data:text/html,hi', 'mailto:a@example.com', 'localhost:3000']) {
      const { issues } = checkRecipe(recipe({ message: { format: 'links', cards: [], text: 'Hi', imageUrl: '', links: [{ label: 'Open', url }] } }), 'instagram')
      expect(issues, url).toContainEqual({ section: 'dm', message: 'Enter a valid link, including https://' })
    }
  })

  it('reports empty keywords and bad links against their sections', () => {
    const { issues } = checkRecipe(
      recipe({
        trigger: changeTriggerType(DEFAULT_RECIPE.trigger, 'dm_keyword'),
        message: { format: 'links', cards: [], text: 'Hi', imageUrl: '', links: [{ label: 'Open', url: 'not a url' }] },
      }),
      'instagram',
    )
    expect(issues).toContainEqual({ section: 'dm', message: 'Enter a valid link, including https://' })

    const unsafe = checkRecipe(
      recipe({ message: { format: 'links', cards: [], text: 'Hi', imageUrl: '', links: [{ label: 'Open', url: 'javascript:alert(1)' }] } }),
      'instagram',
    )
    expect(unsafe.issues).toContainEqual({ section: 'dm', message: 'Enter a valid link, including https://' })

    const badImage = checkRecipe(
      recipe({ message: { format: 'links', cards: [], text: 'Hi', imageUrl: 'data:image/png;base64,AAAA', links: [] } }),
      'instagram',
    )
    expect(badImage.issues).toContainEqual({ section: 'dm', message: 'Enter a valid image link, including https://' })

    const longTag = checkRecipe(recipe({ tags: ['x'.repeat(51)] }), 'instagram')
    expect(longTag.issues).toContainEqual({ section: 'boosters', message: 'Tags must be 1–50 characters' })

    const empty = checkRecipe(recipe({ trigger: { type: 'dm_keyword', keywords: [], match: 'contains' } }), 'instagram')
    expect(empty.issues.map((issue) => issue.section)).toContain('trigger')
  })
})

describe('ice breaker issues', () => {
  it('show up in the trigger section, where the answers are edited', () => {
    const { issues } = checkRecipe(
      recipe({ trigger: { type: 'ice_breaker', items: [{ question: 'What do you offer?', answer: '', links: [] }] } }),
      'instagram',
    )
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.every((issue) => issue.section === 'trigger')).toBe(true)
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
    expect(followGate.message.links).toMatchObject([{ url: 'https://example.com/freebie' }])

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

describe('links and images', () => {
  it('keeps the conversation-starters template pricing button through a save', () => {
    const template = TEMPLATES.find((t) => t.key === 'conversation_starters')!
    const recipe = recipeFromFlow(template.flow)
    expect(recipe.trigger).toMatchObject({ items: [{ links: [] }, { links: [{ label: 'See pricing' }] }, { links: [] }] })
    expect(compileRecipe(recipe).steps.answer_1).toEqual(template.flow.steps.pricing)
  })

  it('compiles up to three delivery links and an image, and reads them back', () => {
    const original = recipe({
      message: {
        format: 'links',
        cards: [],
        text: 'Here',
        imageUrl: 'https://cdn.example.com/a.jpg',
        links: [1, 2, 3].map((n) => ({ label: `Link ${n}`, url: `https://example.com/${n}` })),
      },
    })
    const flow = compileRecipe(original)
    expect(flow.steps.deliver).toMatchObject({ imageUrl: 'https://cdn.example.com/a.jpg' })
    expect(recipeFromFlow(flow).message).toEqual(original.message)
  })

  it('rejects a fourth link', () => {
    const links = [1, 2, 3, 4].map((n) => ({ label: `L${n}`, url: `https://example.com/${n}` }))
    const { issues } = checkRecipe(recipe({ message: { format: 'links', cards: [], text: 'Hi', imageUrl: '', links } }), 'instagram')
    expect(issues.length).toBeGreaterThan(0)
  })
})

describe('any-comment trigger', () => {
  it('accepts a comment recipe with no keywords', () => {
    const base = DEFAULT_RECIPE.trigger
    if (base.type !== 'comment_keyword') throw new Error('default trigger changed')
    const { issues, flow } = checkRecipe(recipe({ trigger: { ...base, keywords: [] } }), 'instagram')
    expect(issues).toEqual([])
    expect(flow.trigger).toMatchObject({ type: 'comment_keyword', keywords: [] })
  })
})

describe('reminder (nudge)', () => {
  const nudge = { enabled: true, afterHours: 3, text: 'Still there?' }
  const expected = { afterMinutes: 180, text: 'Still there?' }

  it('goes on the opener, follow gate and question of a DM flow', () => {
    const flow = compileRecipe(
      recipe({
        trigger: { type: 'any_dm' },
        followGate: { ...DEFAULT_RECIPE.followGate, enabled: true },
        collect: { ...DEFAULT_RECIPE.collect, kind: 'email' },
        nudge,
      }),
    )
    expect(flow.steps.opener).toMatchObject({ nudge: expected })
    expect(flow.steps.ask_follow).toMatchObject({ nudge: expected })
    expect(flow.steps.ask).toMatchObject({ nudge: expected })
    expect(flow.steps.deliver).not.toHaveProperty('nudge')
  })

  it("skips a comment flow's opener, because Meta allows only one private reply", () => {
    const { issues, flow } = checkRecipe(
      recipe({ followGate: { ...DEFAULT_RECIPE.followGate, enabled: true }, nudge }),
      'instagram',
    )
    expect(issues).toEqual([])
    expect(flow.steps.opener).not.toHaveProperty('nudge')
    expect(flow.steps.ask_follow).toMatchObject({ nudge: expected })
  })

  it('round-trips and stays stable', () => {
    const original = recipe({
      trigger: { type: 'any_dm' },
      collect: { ...DEFAULT_RECIPE.collect, kind: 'phone' },
      nudge,
    })
    const flow = compileRecipe(original)
    const back = recipeFromFlow(flow)
    expect(back.nudge).toEqual(nudge)
    expect(compileRecipe(back)).toEqual(flow)
  })

  it('is off by default', () => {
    expect(JSON.stringify(compileRecipe(DEFAULT_RECIPE))).not.toContain('nudge')
  })
})

describe('follow reminder', () => {
  const gated = () => recipe({ followGate: { ...DEFAULT_RECIPE.followGate, enabled: true, reminderText: 'Still not following 👀' } })

  it('sends a separate reminder after a second failed check', () => {
    const flow = compileRecipe(gated())
    expect(validateFlow(flow, 'instagram')).toEqual([])
    expect(flow.steps.ask_follow).toMatchObject({ text: DEFAULT_RECIPE.followGate.text })
    expect(flow.steps.ask_follow).toMatchObject({ buttons: [{ next: 'recheck' }] })
    expect(flow.steps.recheck).toMatchObject({ following: 'deliver', notFollowing: 'remind_follow' })
    expect(flow.steps.remind_follow).toMatchObject({ text: 'Still not following 👀', buttons: [{ next: 'recheck' }] })
  })

  it('round-trips the reminder text and stays stable', () => {
    const flow = compileRecipe(gated())
    const back = recipeFromFlow(flow)
    expect(back.followGate.reminderText).toBe('Still not following 👀')
    expect(compileRecipe(back)).toEqual(flow)
  })

  it('gives flows from before the reminder existed the default text', () => {
    const old = structuredClone(TEMPLATES.find((t) => t.key === 'follow_gate')!.flow)
    delete old.steps.recheck
    delete old.steps.remind_follow
    const ask = old.steps.ask_follow
    if (ask?.type === 'send_message' && ask.buttons?.[0]?.type === 'reply') ask.buttons[0].next = 'check'
    expect(recipeFromFlow(old).followGate.reminderText).toBe(DEFAULT_RECIPE.followGate.reminderText)
  })
})

describe('addChips', () => {
  const limits = { max: 3, maxLength: 5 }

  it('splits on commas, trims and skips empties', () => {
    expect(addChips([], ' a, b ,,c ', limits)).toEqual({ value: ['a', 'b', 'c'], dropped: 0 })
  })

  it('skips duplicates case-insensitively, including inside the pasted batch', () => {
    expect(addChips(['Link'], 'link, Price, PRICE, price', limits)).toEqual({ value: ['Link', 'Price'], dropped: 0 })
  })

  it('stops at the cap and reports how many were left out', () => {
    expect(addChips(['a'], 'b, c, d, e', limits)).toEqual({ value: ['a', 'b', 'c'], dropped: 2 })
  })

  it('cuts words to the maximum length', () => {
    expect(addChips([], 'abcdefgh', limits)).toEqual({ value: ['abcde'], dropped: 0 })
  })
})

describe('setCollectKind', () => {
  it('adds the lead tag, swaps it when the kind changes, and removes it when switched off', () => {
    const r = recipe({ tags: ['vip'] })
    setCollectKind(r, 'email')
    expect(r.collect.kind).toBe('email')
    expect(r.tags).toEqual(['vip', 'email-lead'])

    setCollectKind(r, 'phone')
    expect(r.collect.kind).toBe('phone')
    expect(r.tags).toEqual(['vip', 'phone-lead'])

    setCollectKind(r, 'phone')
    expect(r.collect.kind).toBe('none')
    expect(r.tags).toEqual(['vip'])
  })
})

describe('recipeFromFlow without a message', () => {
  it('leaves the message empty so validation flags it', () => {
    const flow = compileRecipe(recipe({ trigger: { type: 'any_dm' } }))
    flow.steps.opener = { type: 'send_message', text: 'Hi', buttons: [{ type: 'reply', id: 'go', label: 'Go' }] }
    flow.start = 'opener'
    delete flow.steps.deliver
    const back = recipeFromFlow(flow)
    expect(back.message.text).toBe('')
    expect(checkRecipe(back, 'instagram').issues.length).toBeGreaterThan(0)
  })
})

describe('product cards', () => {
  const cards = [
    { title: 'Mug', subtitle: '$19', imageUrl: 'https://cdn.example.com/mug.jpg', buttonLabel: 'Buy', buttonUrl: 'https://shop.example.com/mug' },
    { title: 'Cap', subtitle: '', imageUrl: '', buttonLabel: 'See it', buttonUrl: 'https://shop.example.com/cap' },
  ]
  const dm = (message: Partial<Recipe['message']>) =>
    recipe({
      trigger: { type: 'dm_keyword', keywords: ['SHOP'], match: 'contains' },
      opener: { ...DEFAULT_RECIPE.opener, enabled: false },
      message: { ...DEFAULT_RECIPE.message, ...message },
    })

  it('compiles the cards to a send_products step and reads them back', () => {
    const original = dm({ format: 'products', text: 'My favourites', cards })
    const flow = compileRecipe(original)
    expect(flow.steps.deliver).toEqual({
      type: 'send_products',
      text: 'My favourites',
      cards: [
        { title: 'Mug', subtitle: '$19', imageUrl: 'https://cdn.example.com/mug.jpg', button: { label: 'Buy', url: 'https://shop.example.com/mug' } },
        { title: 'Cap', button: { label: 'See it', url: 'https://shop.example.com/cap' } },
      ],
    })
    expect(validateFlow(flow, 'instagram')).toEqual([])
    const back = recipeFromFlow(flow).message
    expect(back.format).toBe('products')
    expect(back.text).toBe('My favourites')
    expect(back.cards).toEqual(cards)
  })

  it('leaves out blank intro text instead of sending an empty message', () => {
    const flow = compileRecipe(dm({ format: 'products', text: '   ', cards }))
    expect(flow.steps.deliver).not.toHaveProperty('text')
    expect(checkRecipe(dm({ format: 'products', text: '   ', cards }), 'instagram').issues).toEqual([])
  })

  it('adds https:// to card links and images typed without a scheme', () => {
    const flow = compileRecipe(dm({ format: 'products', cards: [{ ...cards[0]!, buttonUrl: 'shop.example.com/mug', imageUrl: 'cdn.example.com/mug.jpg' }] }))
    expect(flow.steps.deliver).toMatchObject({
      cards: [{ imageUrl: 'https://cdn.example.com/mug.jpg', button: { url: 'https://shop.example.com/mug' } }],
    })
  })

  it('keeps links and cards separate when the format is switched back and forth', () => {
    const links = [{ label: 'Open link', url: 'https://example.com/a' }]
    const withBoth = dm({ format: 'links', links, cards })
    expect(compileRecipe(withBoth).steps.deliver).toMatchObject({ type: 'send_message', buttons: [{ type: 'url', url: 'https://example.com/a' }] })
    expect(compileRecipe(withBoth).steps.deliver).not.toHaveProperty('cards')
    const switched = dm({ format: 'products', links, cards })
    expect(compileRecipe(switched).steps.deliver).toMatchObject({ type: 'send_products' })
    expect(compileRecipe(switched).steps.deliver).not.toHaveProperty('buttons')
  })

  it('reports an empty or over-long carousel as a message-section issue', () => {
    const empty = checkRecipe(dm({ format: 'products', cards: [] }), 'instagram')
    expect(empty.issues).toContainEqual({ section: 'dm', message: 'Add at least one product card (max 10)' })
    const long = checkRecipe(dm({ format: 'products', cards: [{ ...cards[0]!, title: 'x'.repeat(81) }] }), 'instagram')
    expect(long.issues).toContainEqual({ section: 'dm', message: 'Card titles and subtitles must be 1–80 characters' })
  })

  it('rejects product cards on Facebook', () => {
    const { issues } = checkRecipe(dm({ format: 'products', cards }), 'facebook')
    expect(issues).toContainEqual({ section: 'dm', message: 'Product cards are only available on Instagram' })
  })

  it('starts a new card empty', () => {
    expect(EMPTY_CARD).toEqual({ title: '', subtitle: '', imageUrl: '', buttonLabel: 'Shop now', buttonUrl: '' })
  })
})
