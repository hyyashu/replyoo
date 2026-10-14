# Product Carousel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an Instagram automation's final message be a carousel of 1 to 10 product cards (image, title, subtitle, one link button), sent as a Meta generic template with tracked links.

**Architecture:** A new `send_products` flow step in `@replyooo/shared` flows through the engine (`OutboundMessage.cards`), the worker (`toSendable`, `withTrackedLinks`) and the Meta client (`SendableMessage` kind `carousel`, mapped to a `generic` template). The dashboard recipe gets a `format: 'links' | 'products'` switch on the final message that compiles to and from `send_products`; the phone preview shows a scrollable card row.

**Tech Stack:** TypeScript, Zod 4 (`@replyooo/shared`), Vitest, Drizzle/Postgres (worker tests), Next.js 16 + next-intl (web), pnpm + Turborepo.

**Spec:** `docs/superpowers/specs/2026-10-14-product-carousel-design.md`

## Global Constraints

- Meta generic template limits: at most **10** cards; card `title` required, **1 to 80** characters; `subtitle` optional, **1 to 80** characters; `image_url` optional; at most 3 buttons per card (we use **one** `web_url` button per card).
- Button labels are 1 to 20 characters (`ButtonLabel`); every URL uses the existing `HttpUrl` rule (`z.httpUrl()`).
- Instagram only: a `send_products` step on a Facebook automation raises a validation issue; the editor hides the format switch for Facebook.
- A comment-triggered flow must still start with a `send_message` that has a reply button. The existing rule `comment_needs_reply_button` already rejects a `send_products` start, so add no new rule for it.
- Not in v1: reply buttons on cards, more than one button per card, `default_action`, reminders (nudge) on the carousel step, importing cards from a page or Shopify.
- Card titles and subtitles are sent exactly as typed (no `{{variable}}` rendering). Only the optional intro `text` is rendered. This amends spec section 4; Task 3 updates the spec line.
- Existing automations and text messages must behave exactly as before. No database migration.
- Internal names stay `@replyooo/*`. New user-facing strings go in both `apps/web/messages/en.json` and `es.json`, and `pnpm --filter @replyooo/web translations:check` must pass.
- Git commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Before writing any Next.js-specific code read the relevant guide in `apps/web/node_modules/next/dist/docs/` (`apps/web/AGENTS.md`). The web tasks here only touch client components, plain modules and JSON, so no Next API is expected; if one turns up, read the guide first.

## Review Focus

Failure modes the spec implies but a straight implementation would not exercise. Each has a test in the task that owns the code:

1. **Blank intro text** (spaces only): must not send an empty message before the carousel, and must not fail validation. Tested in Task 6 (`compileRecipe`).
2. **A carousel on a Facebook automation**: must be flagged, not silently sent. Tested in Task 1.
3. **A retried carousel message**: must reuse the same tracked codes, so links already sent keep working. Tested in Task 4.
4. **Link tracking failing on a carousel**: must send the original card links, never drop the DM. Tested in Task 4.
5. **Switching the format back and forth** in the editor: links typed in "Links" mode and cards typed in "Product cards" mode must both survive, and only the selected mode may reach the compiled flow. Tested in Task 6.
6. **The contact timeline** for a carousel message (empty `text`): must show something readable, not a blank line. Tested in Task 7.

---

### Task 1: `send_products` in the flow schema and validation

**Files:**
- Modify: `packages/shared/src/flow.ts` (add card schema, step variant, draft enum)
- Modify: `packages/shared/src/validate.ts` (`ValidationCode`, `stepTargets`, Facebook rule)
- Test: `packages/shared/test/flow.test.ts`, `packages/shared/test/validate.test.ts`

**Interfaces:**
- Produces (exported from `@replyooo/shared`): `MAX_PRODUCT_CARDS = 10`, `ProductCardSchema`, `type ProductCard = { title: string; subtitle?: string; imageUrl?: string; button: { label: string; url: string } }`, step variant `{ type: 'send_products'; text?: string; cards: ProductCard[]; next?: string }` (so `StepOf<'send_products'>` works), validation code `'carousel_unsupported'`.

- [ ] **Step 1: Write the failing schema tests**

Append to `packages/shared/test/flow.test.ts`:

```ts
describe('send_products step', () => {
  const card = (n: number) => ({ title: `Product ${n}`, button: { label: 'Buy', url: `https://shop.example.com/${n}` } })

  it('accepts 1 to 10 cards with optional text, subtitle and image', () => {
    const one = StepSchema.safeParse({ type: 'send_products', cards: [card(1)] })
    expect(one.success).toBe(true)
    const full = StepSchema.safeParse({
      type: 'send_products',
      text: 'Here are my favourites',
      cards: [{ ...card(1), subtitle: '$19', imageUrl: 'https://cdn.example.com/1.jpg' }],
      next: 'tag',
    })
    expect(full.success).toBe(true)
    const ten = StepSchema.safeParse({ type: 'send_products', cards: Array.from({ length: 10 }, (_, i) => card(i)) })
    expect(ten.success).toBe(true)
  })

  it('rejects zero cards and more than ten', () => {
    expect(StepSchema.safeParse({ type: 'send_products', cards: [] }).success).toBe(false)
    expect(StepSchema.safeParse({ type: 'send_products', cards: Array.from({ length: 11 }, (_, i) => card(i)) }).success).toBe(false)
  })

  it('rejects empty or over-long card text', () => {
    const bad = (patch: object) => StepSchema.safeParse({ type: 'send_products', cards: [{ ...card(1), ...patch }] }).success
    expect(bad({ title: '   ' })).toBe(false)
    expect(bad({ title: 'x'.repeat(81) })).toBe(false)
    expect(bad({ title: 'x'.repeat(80) })).toBe(true)
    expect(bad({ subtitle: 'x'.repeat(81) })).toBe(false)
    expect(bad({ subtitle: '' })).toBe(false)
  })

  it('rejects a bad link, a bad image link and a long button label', () => {
    const bad = (patch: object) => StepSchema.safeParse({ type: 'send_products', cards: [{ ...card(1), ...patch }] }).success
    expect(bad({ button: { label: 'Buy', url: 'javascript:alert(1)' } })).toBe(false)
    expect(bad({ imageUrl: 'not a url' })).toBe(false)
    expect(bad({ button: { label: 'x'.repeat(21), url: 'https://shop.example.com' } })).toBe(false)
  })

  it('lets a half-finished carousel autosave as a draft', () => {
    const draft = DraftFlowSchema.safeParse({
      trigger: { type: 'any_dm' },
      start: 's1',
      steps: { s1: { type: 'send_products', cards: [{ title: '' }] } },
    })
    expect(draft.success).toBe(true)
  })
})
```

Append to `packages/shared/test/validate.test.ts` (inside the file, after the existing `describe('validateFlow'...)` block; `codes` and `validCommentFlow` are already defined at the top):

```ts
describe('send_products validation', () => {
  const carouselFlow: FlowDefinition = {
    trigger: { type: 'any_dm' },
    start: 's1',
    steps: {
      s1: {
        type: 'send_products',
        cards: [{ title: 'Mug', button: { label: 'Buy', url: 'https://shop.example.com/mug' } }],
        next: 's2',
      },
      s2: { type: 'send_message', text: 'Questions? Just reply.' },
    },
  }

  it('accepts a carousel on Instagram and follows its next step', () => {
    expect(validateFlow(carouselFlow, 'instagram')).toEqual([])
  })

  it('reports a missing next step and an unreachable step like any other step', () => {
    const missing = { ...carouselFlow, steps: { ...carouselFlow.steps, s1: { ...carouselFlow.steps.s1!, next: 'ghost' } } } as FlowDefinition
    expect(codes(missing)).toContain('missing_target')
    expect(codes(missing)).toContain('orphan_step')
  })

  it('flags a carousel on Facebook once', () => {
    const twice: FlowDefinition = {
      ...carouselFlow,
      steps: { ...carouselFlow.steps, s2: { type: 'send_products', cards: [{ title: 'Cap', button: { label: 'Buy', url: 'https://shop.example.com/cap' } }] } },
    }
    expect(codes(twice, 'facebook').filter((code) => code === 'carousel_unsupported')).toHaveLength(1)
    expect(codes(carouselFlow, 'instagram')).not.toContain('carousel_unsupported')
  })

  it('does not accept a carousel as the first message after a comment', () => {
    const flow: FlowDefinition = {
      trigger: { type: 'comment_keyword', posts: { mode: 'any' }, keywords: ['SHOP'], match: 'contains' },
      start: 's1',
      steps: { s1: carouselFlow.steps.s1! , s2: carouselFlow.steps.s2! },
    }
    expect(codes(flow)).toContain('comment_needs_reply_button')
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @replyooo/shared exec vitest run test/flow.test.ts test/validate.test.ts`
Expected: FAIL (the `send_products` type is unknown to `StepSchema`; TypeScript errors about the step shape may also print).

- [ ] **Step 3: Implement the schema**

In `packages/shared/src/flow.ts`, after the `ButtonSchema` / `Button` block and before `// ---------- Steps ----------`, add:

```ts
// ---------- Product cards ----------

/** Meta's generic template carries at most ten cards. */
export const MAX_PRODUCT_CARDS = 10
const CardText = z.string().trim().min(1).max(80)

export const ProductCardSchema = z.object({
  title: CardText,
  subtitle: CardText.optional(),
  imageUrl: HttpUrl.optional(),
  button: z.object({ label: ButtonLabel, url: HttpUrl }),
})
export type ProductCard = z.infer<typeof ProductCardSchema>
```

In `StepSchema`, add this variant right after the `send_message` variant (before `ask`):

```ts
  z.object({
    type: z.literal('send_products'),
    /** Optional text sent as its own message just before the carousel. */
    text: MessageText.optional(),
    cards: z.array(ProductCardSchema).min(1).max(MAX_PRODUCT_CARDS),
    next: StepIdSchema.optional(),
  }),
```

In `DraftFlowSchema`, change the enum to:

```ts
    z.looseObject({ type: z.enum(['send_message', 'send_products', 'ask', 'check_follow', 'delay', 'tag', 'condition']) }),
```

- [ ] **Step 4: Implement the validation**

In `packages/shared/src/validate.ts`:

Add `| 'carousel_unsupported'` to the `ValidationCode` union (after `'platform_unsupported'`).

In `stepTargets`, change the shared case:

```ts
    case 'delay':
    case 'tag':
    case 'send_products':
      return [step.next].filter(isDefined)
```

In `validateFlow`, add `let carouselReported = false` next to `let followCheckReported = false`, and inside the `for (const [stepId, step] ...)` loop, next to the `check_follow` platform check, add:

```ts
    if (step.type === 'send_products' && platform === 'facebook' && !carouselReported) {
      carouselReported = true
      issues.push({
        code: 'carousel_unsupported',
        stepId,
        message: 'Product cards are only available on Instagram',
      })
    }
```

`isWaitStep` needs no change: a carousel has no reply buttons, so it falls through to `false`.

- [ ] **Step 5: Run the tests and the type check**

Run: `pnpm --filter @replyooo/shared exec vitest run && pnpm --filter @replyooo/shared typecheck`
Expected: all PASS, no type errors in this package. (Other packages may now report non-exhaustive `switch` errors on `Step`; Tasks 3 and 6 fix those.)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/flow.ts packages/shared/src/validate.ts packages/shared/test/flow.test.ts packages/shared/test/validate.test.ts
git commit -m "feat(shared): send_products step for product carousels

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Meta client builds the generic template

**Files:**
- Modify: `packages/meta/src/types.ts` (`SendableCard`, `SendableMessage`)
- Modify: `packages/meta/src/messages.ts` (`toGraphMessage` carousel branch)
- Test: `packages/meta/test/messages.test.ts`

**Interfaces:**
- Produces: `type SendableCard = { title: string; subtitle?: string; imageUrl?: string; button: { label: string; url: string } }`, `SendableMessage` gains `{ kind: 'carousel'; cards: SendableCard[] }`, constants `MAX_CAROUSEL_CARDS = 10`, `MAX_CARD_TEXT_LENGTH = 80` (exported from `@replyooo/meta`).

- [ ] **Step 1: Write the failing tests**

Add inside the existing `describe('toGraphMessage', ...)` in `packages/meta/test/messages.test.ts`:

```ts
  it('sends a carousel as a generic template with one link button per card', () => {
    expect(
      toGraphMessage({
        kind: 'carousel',
        cards: [
          { title: 'Mug', button: { label: 'Buy', url: 'https://shop.example.com/mug' } },
          {
            title: 'Cap',
            subtitle: '$19',
            imageUrl: 'https://cdn.example.com/cap.jpg',
            button: { label: 'See it', url: 'https://shop.example.com/cap' },
          },
        ],
      }),
    ).toEqual({
      attachment: {
        type: 'template',
        payload: {
          template_type: 'generic',
          elements: [
            { title: 'Mug', buttons: [{ type: 'web_url', title: 'Buy', url: 'https://shop.example.com/mug' }] },
            {
              title: 'Cap',
              subtitle: '$19',
              image_url: 'https://cdn.example.com/cap.jpg',
              buttons: [{ type: 'web_url', title: 'See it', url: 'https://shop.example.com/cap' }],
            },
          ],
        },
      },
    })
  })

  it('truncates card text to 80 characters and never sends more than ten cards', () => {
    const cards = Array.from({ length: 12 }, (_, i) => ({
      title: 't'.repeat(100),
      subtitle: 's'.repeat(100),
      button: { label: 'Buy', url: `https://shop.example.com/${i}` },
    }))
    const message = toGraphMessage({ kind: 'carousel', cards }) as {
      attachment: { payload: { elements: { title: string; subtitle: string }[] } }
    }
    const { elements } = message.attachment.payload
    expect(elements).toHaveLength(10)
    expect(elements[0]!.title).toHaveLength(80)
    expect(elements[0]!.title.endsWith('…')).toBe(true)
    expect(elements[0]!.subtitle).toHaveLength(80)
  })
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @replyooo/meta exec vitest run test/messages.test.ts`
Expected: FAIL (`kind: 'carousel'` falls through to the text branch and crashes on `message.text`/buttons, or fails the type check).

- [ ] **Step 3: Implement**

In `packages/meta/src/types.ts`, replace the `SendableMessage` block with:

```ts
export interface SendableCard {
  title: string
  subtitle?: string
  imageUrl?: string
  button: { label: string; url: string }
}

/** Exactly one Graph send call. */
export type SendableMessage =
  | { kind: 'text'; text: string; buttons?: SendableButton[] }
  | { kind: 'image'; url: string }
  | { kind: 'carousel'; cards: SendableCard[] }
```

In `packages/meta/src/messages.ts`, add the constants next to the existing two:

```ts
export const MAX_CAROUSEL_CARDS = 10
export const MAX_CARD_TEXT_LENGTH = 80
```

and, in `toGraphMessage`, right after the `image` branch:

```ts
  if (message.kind === 'carousel') {
    return {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'generic',
          elements: message.cards.slice(0, MAX_CAROUSEL_CARDS).map((card) => ({
            title: truncate(card.title, MAX_CARD_TEXT_LENGTH),
            ...(card.subtitle ? { subtitle: truncate(card.subtitle, MAX_CARD_TEXT_LENGTH) } : {}),
            ...(card.imageUrl ? { image_url: card.imageUrl } : {}),
            buttons: [{ type: 'web_url', title: card.button.label, url: card.button.url }],
          })),
        },
      },
    }
  }
```

- [ ] **Step 4: Run tests and type check**

Run: `pnpm --filter @replyooo/meta exec vitest run && pnpm --filter @replyooo/meta typecheck`
Expected: PASS. If a type error names the Facebook or Instagram adapter, it is only because a `switch` on `kind` needs the new case; both adapters call `toGraphMessage` and need no change.

- [ ] **Step 5: Commit**

```bash
git add packages/meta/src/types.ts packages/meta/src/messages.ts packages/meta/test/messages.test.ts
git commit -m "feat(meta): send product carousels as a generic template

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Engine runs `send_products`

**Files:**
- Modify: `packages/engine/src/types.ts` (`OutboundCard`, `OutboundMessage.cards`)
- Modify: `packages/engine/src/advance.ts` (`execute` case)
- Modify: `docs/superpowers/specs/2026-10-14-product-carousel-design.md` (section 4 wording)
- Test: `packages/engine/test/advance-core.test.ts`

**Interfaces:**
- Consumes: `StepOf<'send_products'>`, `ProductCard` from Task 1.
- Produces: `OutboundCard = ProductCard`; `OutboundMessage` gains `cards?: OutboundCard[]`. A carousel message is `{ text: '', cards }`. `advance` emits, for a `send_products` step: an optional `{ type: 'send', message: { text } }` (rendered intro) then `{ type: 'send', message: { text: '', cards } }`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/engine/test/advance-core.test.ts` (new `describe` at the end of the file; `Driver` and `dmFlow` are already imported there):

```ts
describe('advance: send_products', () => {
  const cards = [
    { title: 'Mug {{first_name}}', subtitle: '$19', button: { label: 'Buy', url: 'https://shop.example.com/mug' } },
    { title: 'Cap', imageUrl: 'https://cdn.example.com/cap.jpg', button: { label: 'See it', url: 'https://shop.example.com/cap' } },
  ]

  it('sends the carousel and continues to the next step', () => {
    const driver = new Driver(
      dmFlow({
        s1: { type: 'send_products', cards, next: 's2' },
        s2: { type: 'tag', add: ['saw-products'] },
      }),
    )
    const result = driver.startDm()
    expect(result.effects).toEqual([
      { type: 'send', message: { text: '', cards } },
      { type: 'update_contact', patch: { addTags: ['saw-products'] } },
    ])
    expect(result.run.status).toBe('completed')
  })

  it('sends the rendered intro text as its own message before the carousel', () => {
    const driver = new Driver(dmFlow({ s1: { type: 'send_products', text: 'Hi {{first_name|there}}, take a look', cards } }))
    driver.startDm()
    expect(driver.effects).toEqual([
      { type: 'send', message: { text: 'Hi Priya, take a look' } },
      { type: 'send', message: { text: '', cards } },
    ])
  })

  it('sends card text exactly as typed, without rendering variables', () => {
    const driver = new Driver(dmFlow({ s1: { type: 'send_products', cards } }))
    driver.startDm()
    const sent = driver.effects[0]
    expect(sent?.type === 'send' && sent.message.cards?.[0]?.title).toBe('Mug {{first_name}}')
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @replyooo/engine exec vitest run test/advance-core.test.ts`
Expected: FAIL (`execute` has no `send_products` case; the type check also reports a non-exhaustive switch).

- [ ] **Step 3: Implement**

In `packages/engine/src/types.ts`, change the first line to `import type { FlowDefinition, ProductCard } from '@replyooo/shared'`, then replace the `OutboundMessage` interface with:

```ts
export type OutboundCard = ProductCard

export interface OutboundMessage {
  text: string
  imageUrl?: string
  buttons?: OutboundButton[]
  /** A carousel message has empty `text`; the intro text is sent as its own earlier message. */
  cards?: OutboundCard[]
}
```

In `packages/engine/src/advance.ts`, add a case to `execute` right after the `send_message` case:

```ts
    case 'send_products': {
      const intro = step.text ? renderText(step.text, ctx.contact, ctx.run.vars) : ''
      if (intro.trim() !== '' && !send(ctx, { text: intro })) return 'stop'
      if (!send(ctx, { text: '', cards: step.cards })) return 'stop'
      return { next: step.next }
    }
```

If `intro` renders to blank (all variables empty), the intro message is skipped instead of sent empty.

Amend the spec: in `docs/superpowers/specs/2026-10-14-product-carousel-design.md`, section 4, find the sentence that says text rendering (variables like `first_name`) applies to the text, titles and subtitles, and replace it with: "Only the intro text is rendered with variables; card titles and subtitles are sent exactly as typed, so a blank variable can never produce an empty title, which Meta rejects."

- [ ] **Step 4: Run tests and type check**

Run: `pnpm --filter @replyooo/engine exec vitest run && pnpm --filter @replyooo/engine typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/types.ts packages/engine/src/advance.ts packages/engine/test/advance-core.test.ts docs/superpowers/specs/2026-10-14-product-carousel-design.md
git commit -m "feat(engine): run send_products steps

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Worker sends carousels and tracks card links

**Files:**
- Modify: `apps/worker/src/outbound.ts` (`toSendable`, `withTrackedLinks`)
- Test: `apps/worker/test/outbound.test.ts`, `apps/worker/test/flow.test.ts`

**Interfaces:**
- Consumes: `OutboundMessage.cards` (Task 3), `SendableMessage` kind `carousel` (Task 2).
- Produces: `toSendable(body, runId)` returns `{ kind: 'carousel', cards }` when `body.message.cards` is non-empty. `withTrackedLinks` stores one tracked link per card with `position` = card index and swaps each card's `button.url` for `${origin}/l/<code>`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/worker/test/outbound.test.ts`, inside `describe('link tracking', ...)` (it already defines `setup`, `queue`, `shop`, and imports `trackedLinks`, `withTrackedLinks`, `handleOutbound`, `OutboundBody`):

```ts
  const carousel = (): OutboundBody => ({
    type: 'message',
    message: {
      text: '',
      cards: [
        { title: 'Mug', button: { label: 'Buy', url: 'https://shop.example/mug' } },
        { title: 'Cap', subtitle: '$19', imageUrl: 'https://cdn.example/cap.jpg', button: { label: 'Buy', url: 'https://shop.example/cap' } },
      ],
    },
  })

  type SentCarousel = { kind: string; cards: { title: string; subtitle?: string; imageUrl?: string; button: { label: string; url: string } }[] }
  const sentCarousel = (adapters: Awaited<ReturnType<typeof setup>>['adapters']) =>
    adapters.instagram.sent('sendMessage')[0]?.args[1] as SentCarousel

  it('sends a carousel with a tracked link per card and keeps the real destinations in the database', async () => {
    const { db, deps, adapters, queue } = await setup()
    const [id] = await queue({ kind: 'dm', body: carousel() })
    await handleOutbound(deps, { messageIds: [id!] })

    const rows = await db.select().from(trackedLinks).where(eq(trackedLinks.messageId, id!))
    expect(rows.map((r) => [r.position, r.url]).sort()).toEqual([
      [0, 'https://shop.example/mug'],
      [1, 'https://shop.example/cap'],
    ])
    const byPosition = Object.fromEntries(rows.map((r) => [r.position, r.code]))
    const sent = sentCarousel(adapters)
    expect(sent.kind).toBe('carousel')
    expect(sent.cards[0]).toEqual({ title: 'Mug', button: { label: 'Buy', url: `http://localhost:3000/l/${byPosition[0]}` } })
    expect(sent.cards[1]).toEqual({
      title: 'Cap',
      subtitle: '$19',
      imageUrl: 'https://cdn.example/cap.jpg',
      button: { label: 'Buy', url: `http://localhost:3000/l/${byPosition[1]}` },
    })
  })

  it('reuses the same carousel codes when a message is retried', async () => {
    const { deps, queue, db } = await setup()
    const [id] = await queue({ kind: 'dm', body: carousel() })
    const [row] = await db.select().from(messages).where(eq(messages.id, id!))
    const first = await withTrackedLinks(deps, row!)
    const second = await withTrackedLinks(deps, row!)
    expect(second.body).toEqual(first.body)
  })

  it('falls back to the original card links when tracking fails', async () => {
    const { deps, queue, db } = await setup()
    const [id] = await queue({ kind: 'dm', body: carousel() })
    const [row] = await db.select().from(messages).where(eq(messages.id, id!))
    const failing = async () => {
      throw new Error('db down')
    }
    const result = await withTrackedLinks(deps, row!, failing as never)
    expect(result.body).toEqual(row!.body)
  })
```

Add to `apps/worker/test/flow.test.ts` (import `outboundRows` from `'../src/flow'` if the file does not already import it; check the file's existing imports and add to them):

```ts
describe('outboundRows: carousel', () => {
  it('turns a carousel effect into a single message row with its cards', () => {
    const cards = [{ title: 'Mug', button: { label: 'Buy', url: 'https://shop.example/mug' } }]
    expect(outboundRows([{ type: 'send', message: { text: '', cards } }])).toEqual([
      { kind: 'dm', commentId: null, body: { type: 'message', message: { text: '', cards } } },
    ])
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @replyooo/worker exec vitest run test/outbound.test.ts test/flow.test.ts`
Expected: FAIL (the carousel is sent as a plain text message and no tracked links are created). Worker tests need the local Postgres container used by the other worker tests; if they cannot connect, start it the same way you do for `pnpm test` at the repo root.

- [ ] **Step 3: Implement**

In `apps/worker/src/outbound.ts`, replace the link-gathering and body-building part of `withTrackedLinks` (from `const buttons = ...` through the `trackedBody` assignment) with:

```ts
  const buttons = body.message.buttons ?? []
  const cards = body.message.cards ?? []
  const links = [
    ...buttons.flatMap((button, position) => (button.type === 'url' ? [{ position, url: button.url }] : [])),
    // A message carries buttons or cards, never both, so card positions cannot clash with button positions.
    ...cards.map((card, position) => ({ position, url: card.button.url })),
  ]
  if (links.length === 0) return message
  try {
    const [run] = await deps.db.select({ automationId: flowRuns.automationId }).from(flowRuns).where(eq(flowRuns.id, message.flowRunId))
    if (!run) return message
    const codes = await create(deps.db, { messageId: message.id, contactId: message.contactId, automationId: run.automationId, links })
    const origin = deps.appUrl.replace(/\/+$/, '')
    const tracked = buttons.map((button, position) => {
      const code = codes.get(position)
      return button.type === 'url' && code ? { ...button, url: `${origin}/l/${code}` } : button
    })
    const trackedCards = cards.map((card, position) => {
      const code = codes.get(position)
      return code ? { ...card, button: { ...card.button, url: `${origin}/l/${code}` } } : card
    })
    const trackedBody: OutboundBody = {
      type: 'message',
      message: {
        ...body.message,
        ...(buttons.length > 0 ? { buttons: tracked } : {}),
        ...(cards.length > 0 ? { cards: trackedCards } : {}),
      },
    }
    return { ...message, body: trackedBody as unknown as Record<string, unknown> }
  } catch (error) {
```

Keep the existing `catch` block and the rest of the function unchanged (the `const [run] = ...` line shown above is the existing one; it is repeated here only so the replacement is contiguous).

In `toSendable`, add before the `const buttons = ...` line:

```ts
  if (body.message.cards && body.message.cards.length > 0) return { kind: 'carousel', cards: body.message.cards }
```

- [ ] **Step 4: Run tests and type check**

Run: `pnpm --filter @replyooo/worker exec vitest run && pnpm --filter @replyooo/worker typecheck`
Expected: PASS, including the pre-existing link-tracking tests.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/outbound.ts apps/worker/test/outbound.test.ts apps/worker/test/flow.test.ts
git commit -m "feat(worker): send carousels with tracked card links

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: End-to-end worker run

**Files:**
- Test: `apps/worker/test/e2e.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 4. Uses the file's existing `sent` array (shared by every test in the file, so the new test measures from a baseline), `deps`, `waitFor`, `publishAutomation`, `seedAccount`, `createServer`, `SECRET`.

- [ ] **Step 1: Write the test**

Add this test inside `describe('worker end to end', ...)` in `apps/worker/test/e2e.test.ts`, after the existing test:

```ts
  it('comment → opener → tap → intro text then a carousel with tracked card links', async () => {
    const db = deps.db
    const { account } = await seedAccount(db)
    const carouselFlow: FlowDefinition = {
      trigger: { type: 'comment_keyword', posts: { mode: 'any' }, keywords: ['shop'], match: 'contains' },
      start: 'opener',
      steps: {
        opener: { type: 'send_message', text: 'Tap below', buttons: [{ type: 'reply', id: 'go', label: 'Show me', next: 'deliver' }] },
        deliver: {
          type: 'send_products',
          text: 'My favourites',
          cards: [
            { title: 'Mug', subtitle: '$19', button: { label: 'Buy', url: 'https://shop.example/mug' } },
            { title: 'Cap', imageUrl: 'https://cdn.example/cap.jpg', button: { label: 'Buy', url: 'https://shop.example/cap' } },
          ],
        },
      },
    }
    await publishAutomation(db, account, carouselFlow)
    const app = createServer(deps, { verifyToken: 'v', appSecrets: [SECRET] })
    const post = (payload: unknown) => {
      const body = JSON.stringify(payload)
      const signature = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`
      return app.request('/webhooks/meta', { method: 'POST', body, headers: { 'x-hub-signature-256': signature } })
    }
    const base = sent.length
    const commentId = `c_${randomUUID()}`
    const now = Date.now()
    await post({
      object: 'instagram',
      entry: [
        {
          id: account.externalId,
          time: Math.floor(now / 1000),
          changes: [{ field: 'comments', value: { id: commentId, text: 'SHOP please', from: { id: 'igsid_shop', username: 'sam' }, media: { id: 'm1' } } }],
        },
      ],
    })
    await waitFor(async () => sent.length >= base + 1)
    const opener = sent.slice(base).find((s) => s.path === 'messages')!
    const payload: string = opener.body.message.attachment.payload.buttons[0].payload

    await post({
      object: 'instagram',
      entry: [
        {
          id: account.externalId,
          time: now,
          messaging: [
            {
              sender: { id: 'igsid_shop' },
              recipient: { id: account.externalId },
              timestamp: now,
              postback: { mid: `mid.${randomUUID()}`, title: 'Show me', payload },
            },
          ],
        },
      ],
    })
    await waitFor(async () => sent.slice(base).filter((s) => s.path === 'messages').length >= 3)

    const dms = sent.slice(base).filter((s) => s.path === 'messages' && s.body.recipient.id === 'igsid_shop')
    expect(dms[0]?.body.message).toEqual({ text: 'My favourites' })
    const template = dms[1]?.body.message.attachment
    expect(template.type).toBe('template')
    expect(template.payload.template_type).toBe('generic')
    const elements = template.payload.elements as { title: string; subtitle?: string; image_url?: string; buttons: unknown[] }[]
    expect(elements.map((e) => e.title)).toEqual(['Mug', 'Cap'])
    expect(elements[0]?.subtitle).toBe('$19')
    expect(elements[1]?.image_url).toBe('https://cdn.example/cap.jpg')
    for (const element of elements) {
      expect(element.buttons).toEqual([
        { type: 'web_url', title: 'Buy', url: expect.stringMatching(/^http:\/\/localhost:3000\/l\/[0-9A-Za-z]{8}$/) },
      ])
    }
  })
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @replyooo/worker exec vitest run test/e2e.test.ts`
Expected: PASS once Tasks 1 to 4 are in place (this task adds coverage, not behaviour). If the intro text arrives after the carousel, the order of the two `send` effects in Task 3 is wrong; fix it there. If the existing first test starts failing on its absolute `sent` counts, change its counts to be relative to a baseline taken at its start, the same way this test does.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/test/e2e.test.ts
git commit -m "test(worker): end-to-end product carousel run

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Recipe compiles and reads back the carousel

**Files:**
- Modify: `apps/web/src/lib/recipe.ts` (types, defaults, `compileRecipe`, `recipeFromFlow`)
- Modify: `apps/web/src/lib/validation.ts` (error wording for cards)
- Modify: `apps/web/src/i18n/errors.ts`, `apps/web/messages/en.json`, `apps/web/messages/es.json` (error codes)
- Test: `apps/web/test/recipe.test.ts`

**Interfaces:**
- Consumes: `send_products` step and `MAX_PRODUCT_CARDS` from Task 1.
- Produces:
  - `export interface CardInput { title: string; subtitle: string; imageUrl: string; buttonLabel: string; buttonUrl: string }`
  - `Recipe['message']` becomes `{ format: 'links' | 'products'; text: string; imageUrl: string; links: LinkButton[]; cards: CardInput[] }`
  - `export const MAX_CARDS = MAX_PRODUCT_CARDS` and `export const EMPTY_CARD: CardInput`
  - `compileRecipe` emits `steps.deliver` as `send_products` when `format === 'products'`; `recipeFromFlow` reads it back.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/test/recipe.test.ts` (imports at the top already include `DEFAULT_RECIPE`, `compileRecipe`, `recipeFromFlow`, `type Recipe`, `checkRecipe`, `validateFlow`; add `EMPTY_CARD` to the `@/lib/recipe` import):

```ts
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
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @replyooo/web exec vitest run test/recipe.test.ts`
Expected: FAIL (`EMPTY_CARD` does not exist; `format` is not a known key).

- [ ] **Step 3: Implement the recipe**

In `apps/web/src/lib/recipe.ts`:

1. Add `MAX_PRODUCT_CARDS` to the shared import: `import { MAX_PRODUCT_CARDS, type Button, type FlowDefinition, type Step, type StepOf, type Trigger } from '@replyooo/shared'` (keep existing members).

2. After `export const MAX_LINKS = 3` add:

```ts
export const MAX_CARDS = MAX_PRODUCT_CARDS

/** One product card as typed in the editor; compiled to a `send_products` card. */
export interface CardInput {
  title: string
  subtitle: string
  imageUrl: string
  buttonLabel: string
  buttonUrl: string
}

export const EMPTY_CARD: CardInput = { title: '', subtitle: '', imageUrl: '', buttonLabel: 'Shop now', buttonUrl: '' }
```

3. Replace the `message` line of the `Recipe` interface:

```ts
  /**
   * The final message. `format` picks what is sent: text with link buttons (`imageUrl` goes just before it as its own
   * picture), or a carousel of product cards where `text` is an optional intro. Both sets of fields are kept so
   * switching format in the editor loses nothing; only the selected one is compiled.
   */
  message: { format: 'links' | 'products'; text: string; imageUrl: string; links: LinkButton[]; cards: CardInput[] }
```

4. In `DEFAULT_RECIPE`, change the message line to:

```ts
  message: { format: 'links', text: 'Here you go! 🎉', imageUrl: '', links: [{ label: 'Open link', url: 'https://example.com' }], cards: [] },
```

5. In `compileRecipe`, replace the `steps.deliver = { ... }` assignment with:

```ts
  steps.deliver =
    recipe.message.format === 'products'
      ? {
          type: 'send_products',
          ...(recipe.message.text.trim() ? { text: recipe.message.text } : {}),
          cards: recipe.message.cards.map(compileCard),
          ...(head ? { next: head } : {}),
        }
      : {
          type: 'send_message',
          text: recipe.message.text,
          ...(recipe.message.imageUrl ? { imageUrl: normalizeUrl(recipe.message.imageUrl) } : {}),
          ...withLinks(recipe.message.links),
          ...(head ? { next: head } : {}),
        }
```

and add, next to `withLinks`:

```ts
function compileCard(card: CardInput): StepOf<'send_products'>['cards'][number] {
  return {
    title: card.title,
    ...(card.subtitle.trim() ? { subtitle: card.subtitle } : {}),
    ...(card.imageUrl.trim() ? { imageUrl: normalizeUrl(card.imageUrl) } : {}),
    button: { label: card.buttonLabel, url: normalizeUrl(card.buttonUrl) },
  }
}
```

6. In `recipeFromFlow`, set `recipe.message.cards = []` next to `recipe.message.links = []` near the top, and add a case in the `switch (step.type)` after `case 'send_message'`:

```ts
      case 'send_products':
        messageFound = true
        recipe.message.format = 'products'
        recipe.message.text = step.text ?? ''
        recipe.message.cards = step.cards.map((card) => ({
          title: card.title,
          subtitle: card.subtitle ?? '',
          imageUrl: card.imageUrl ?? '',
          buttonLabel: card.button.label,
          buttonUrl: card.button.url,
        }))
        id = step.next
        break
```

- [ ] **Step 4: Implement the error wording**

In `apps/web/src/lib/validation.ts`, in `describe()`, before the `if (last === 'label')` line add:

```ts
  if (last === 'cards') return 'Add at least one product card (max 10)'
  if (last === 'title' || last === 'subtitle') return 'Card titles and subtitles must be 1–80 characters'
```

In `apps/web/src/i18n/errors.ts`, add to the `codes` map:

```ts
  'Add at least one product card (max 10)': 'cards',
  'Card titles and subtitles must be 1–80 characters': 'cardText',
  'Product cards are only available on Instagram': 'cardsInstagramOnly',
```

In `apps/web/messages/en.json`, in the `errors` object next to `"instagramOnly"`:

```json
    "cards": "Add at least one product card (max 10)",
    "cardText": "Card titles and subtitles must be 1–80 characters",
    "cardsInstagramOnly": "Product cards are only available on Instagram",
```

In `apps/web/messages/es.json`, same place:

```json
    "cards": "Añade al menos una tarjeta de producto (máx. 10)",
    "cardText": "Los títulos y subtítulos de las tarjetas deben tener entre 1 y 80 caracteres",
    "cardsInstagramOnly": "Las tarjetas de producto solo están disponibles en Instagram",
```

(Keep the files' valid JSON: check the comma after the preceding line.)

- [ ] **Step 5: Fix the other places that build `message`**

Run: `pnpm --filter @replyooo/web typecheck`
For every error of the form "Property 'format' is missing" or "'cards' is missing", add `format: 'links', cards: []` to that `message: { ... }` literal (expect the `message: {...}` literals in `apps/web/test/recipe.test.ts`; fix every file the compiler reports and no others. Only change a literal typed as a `Recipe` message; `apps/web/src/app/(marketing)/page.tsx` has an unrelated `message:` object that stays as is unless the compiler reports it). In `recipe.test.ts` the equality assertion in `compiles up to three delivery links and an image, and reads them back` compares `recipeFromFlow(flow).message` to `original.message`; with the new fields in the literal it still holds.

- [ ] **Step 6: Run tests, type check and translations**

Run: `pnpm --filter @replyooo/web exec vitest run test/recipe.test.ts test/i18n-errors.test.ts test/i18n-catalogs.test.ts && pnpm --filter @replyooo/web typecheck && pnpm --filter @replyooo/web translations:check`
Expected: all PASS / clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/recipe.ts apps/web/src/lib/validation.ts apps/web/src/i18n/errors.ts apps/web/messages/en.json apps/web/messages/es.json apps/web/test/recipe.test.ts
git commit -m "feat(web): recipe support for product cards

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(Also `git add` every other file the typecheck fix in Step 5 touched.)

---

### Task 7: Editor, phone preview and timeline text

**Files:**
- Modify: `apps/web/src/app/(app)/automations/[id]/sections.tsx` (`DmSection` format switch, `CardsEditor`)
- Modify: `apps/web/src/app/(app)/automations/[id]/editor.tsx` (pass `platform` to `DmSection`)
- Modify: `apps/web/src/components/phone-preview.tsx` (card bubble)
- Modify: `apps/web/src/lib/data/contacts.ts` (`messageText`)
- Modify: `apps/web/messages/en.json`, `apps/web/messages/es.json` (`automations` keys)
- Test: `apps/web/test/phone-preview-localization.test.ts`, `apps/web/test/contacts.test.ts`

**Interfaces:**
- Consumes: `Recipe['message']`, `CardInput`, `EMPTY_CARD`, `MAX_CARDS` from Task 6.
- Produces: `conversation()` returns a `{ kind: 'cards'; intro?... }` bubble list (see Step 3); `messageText` returns `🛍 Product carousel (N)` for a carousel body.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/test/phone-preview-localization.test.ts`:

```ts
it('shows a carousel of product cards in the preview', () => {
  const recipe = structuredClone(DEFAULT_RECIPE)
  recipe.message.format = 'products'
  recipe.message.text = 'My favourites'
  recipe.message.cards = [
    { title: 'Mug', subtitle: '$19', imageUrl: '', buttonLabel: 'Buy', buttonUrl: 'https://shop.example.com/mug' },
    { title: 'Cap', subtitle: '', imageUrl: '', buttonLabel: 'See it', buttonUrl: 'https://shop.example.com/cap' },
  ]
  const html = renderToString(createElement(PhonePreview, { recipe, mode: 'dm', username: 'example' }))
  expect(html).toContain('My favourites')
  expect(html).toContain('Mug')
  expect(html).toContain('$19')
  expect(html).toContain('Cap')
  expect(html).toContain('Buy')
})
```

Add to the `describe('messageText', ...)` block in `apps/web/test/contacts.test.ts`:

```ts
  it('describes a carousel message instead of showing a blank line', () => {
    const cards = [{ title: 'Mug' }, { title: 'Cap' }]
    expect(messageText({ type: 'message', message: { text: '', cards } })).toBe('🛍 Product carousel (2 cards)')
    expect(messageText({ type: 'message', message: { text: '', cards: [{ title: 'Mug' }] } })).toBe('🛍 Product carousel (1 card)')
  })
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @replyooo/web exec vitest run test/phone-preview-localization.test.ts test/contacts.test.ts`
Expected: FAIL (the preview ignores `format`; `messageText` returns an empty string).

- [ ] **Step 3: Implement the preview**

In `apps/web/src/components/phone-preview.tsx`:

Add to the `Bubble` union:

```ts
  | { kind: 'cards'; cards: { title: string; subtitle: string; imageUrl: string; label: string; url: string }[] }
```

In `conversation()`, replace the final block (from `if (recipe.message.imageUrl) bubbles.push(...)` to the closing `bubbles.push({...})`) with:

```ts
  if (recipe.message.format === 'products') {
    if (recipe.message.text.trim()) bubbles.push({ kind: 'us', text: render(recipe.message.text, contact) })
    bubbles.push({
      kind: 'cards',
      cards: recipe.message.cards.map((card) => ({
        title: card.title || '…',
        subtitle: card.subtitle,
        imageUrl: card.imageUrl,
        label: card.buttonLabel || (translate ? translate('previewOpen') : 'Open'),
        url: card.buttonUrl,
      })),
    })
    return bubbles
  }
  if (recipe.message.imageUrl) bubbles.push({ kind: 'us', text: translate ? translate('previewImage') : '🖼 Image' })
  bubbles.push({
    kind: 'us',
    text: render(recipe.message.text, contact),
    ...previewLinks(recipe.message.links, translate),
  })
```

In `DmView`'s `bubbles.map`, add a branch right after the `them` branch (before the final `return`):

```tsx
          if (bubble.kind === 'cards') {
            return (
              <div key={index} className="-mx-3.5 flex gap-2 self-stretch overflow-x-auto px-3.5 pb-1 [scrollbar-width:none]">
                {bubble.cards.map((card, cardIndex) => (
                  <div key={cardIndex} className="w-[160px] shrink-0 overflow-hidden rounded-[14px] border border-line bg-white">
                    {card.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={card.imageUrl} alt="" className="aspect-square w-full object-cover" />
                    ) : (
                      <div className="aspect-square w-full bg-sand" />
                    )}
                    <div className="px-2.5 pt-2">
                      <div className="text-[12px] leading-snug font-semibold">{card.title}</div>
                      {card.subtitle && <div className="text-[11px] leading-snug text-subtle">{card.subtitle}</div>}
                    </div>
                    <div className="m-2 flex items-center justify-center gap-1 rounded-lg bg-cream py-1.5 text-[12px] font-semibold text-[#3b5bdb]">
                      {card.label} <ExternalLink className="size-3" />
                    </div>
                  </div>
                ))}
              </div>
            )
          }
```

If the repo lints `<img>` differently (check how other components render remote images, e.g. in `bio-page-view.tsx`), match that approach and drop the eslint comment if unused.

- [ ] **Step 4: Implement `messageText`**

In `apps/web/src/lib/data/contacts.ts`, replace the `if (body.type === 'message')` block with:

```ts
  if (body.type === 'message') {
    const message = body.message as { text?: unknown; cards?: unknown } | undefined
    if (Array.isArray(message?.cards) && message.cards.length > 0) {
      const count = message.cards.length
      return `🛍 Product carousel (${count} ${count === 1 ? 'card' : 'cards'})`
    }
    if (typeof message?.text === 'string') return message.text
  }
```

- [ ] **Step 5: Implement the editor**

In `apps/web/src/app/(app)/automations/[id]/editor.tsx`, line ~463, pass the platform:

```tsx
            <DmSection index={hasPublicReply ? 3 : 2} recipe={recipe} update={update} platform={platform} issues={sectionIssues} />
```

In `apps/web/src/app/(app)/automations/[id]/sections.tsx`:

1. Extend the lucide import with `ArrowDown, ArrowUp`. Extend the `@/lib/recipe` import with `EMPTY_CARD, MAX_CARDS, type CardInput`.

2. Add `platform` to `DmSection`'s props (`platform: Platform`) and compute `const products = recipe.message.format === 'products'` next to `const { links } = recipe.message`. Change the `subtitle` array's last entry to `products ? tr('cardsCount', { count: recipe.message.cards.length }) : links.length > 0 && tr('linksCount', { count: links.length })`.

3. Replace the second `<div>` of the section (the one starting `<Label hint={opener ? tr('sent_after_they_tap') ...`) with:

```tsx
      <div>
        {platform === 'instagram' && (
          <div className="mb-3">
            <Segmented
              value={recipe.message.format}
              options={[
                { value: 'links', label: tr('format_links') },
                { value: 'products', label: tr('format_products') },
              ]}
              onChange={(format) =>
                update((d) => {
                  d.message.format = format
                  if (format === 'products' && d.message.cards.length === 0) d.message.cards.push({ ...EMPTY_CARD })
                })
              }
            />
          </div>
        )}
        <Label hint={opener ? tr('sent_after_they_tap') : undefined}>
          {products ? tr('intro_optional') : opener ? tr('then_send') : tr('message_4')}
        </Label>
        <MessageInput
          label={products ? tr('intro_optional') : opener ? tr('then_send') : tr('message_4')}
          value={recipe.message.text}
          maxLength={!products && links.length > 0 ? 640 : 1000}
          onChange={(text) => update((d) => void (d.message.text = text))}
          footer={products ? undefined : <LinkButtons links={links} onChange={(next) => update((d) => void (d.message.links = next))} />}
        />
        {products ? (
          <CardsEditor cards={recipe.message.cards} onChange={(cards) => update((d) => void (d.message.cards = cards))} />
        ) : (
          <div className="mt-3">
            <Label hint={tr('sent_as_a_picture_just_before_the_message')}>{tr('image_optional')}</Label>
            <TextInput
              label={tr('image_optional')}
              value={recipe.message.imageUrl}
              placeholder={tr('https_link_to_a_jpg_or_png')}
              onChange={(imageUrl) => update((d) => void (d.message.imageUrl = imageUrl.trim()))}
              onBlur={(e) => update((d) => void (d.message.imageUrl = normalizeUrl(e.target.value)))}
            />
          </div>
        )}
      </div>
```

If `MessageInput`'s `footer` prop is required (check its definition in `fields.tsx`), pass `footer={null}` instead of `undefined`.

4. Add the component after `LinkButtons`:

```tsx
function CardsEditor({ cards, onChange }: { cards: CardInput[]; onChange: (cards: CardInput[]) => void }) {
  const tr = useTranslations('automations')
  const change = (index: number, patch: Partial<CardInput>) => onChange(cards.map((card, i) => (i === index ? { ...card, ...patch } : card)))
  const move = (index: number, by: -1 | 1) => {
    const next = [...cards]
    const [card] = next.splice(index, 1)
    next.splice(index + by, 0, card!)
    onChange(next)
  }
  return (
    <div className="mt-3 flex flex-col gap-3">
      <p className="text-[12.5px] text-subtle">{tr('cards_hint')}</p>
      {cards.map((card, index) => (
        <div key={index} className="flex flex-col gap-2 rounded-[14px] border border-line p-3">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-semibold">{tr('card_n', { v0: index + 1 })}</span>
            <span className="flex items-center gap-1">
              <button type="button" aria-label={tr('move_card_up')} disabled={index === 0} className="text-faint hover:text-ink disabled:opacity-30" onClick={() => move(index, -1)}>
                <ArrowUp className="size-3.5" />
              </button>
              <button type="button" aria-label={tr('move_card_down')} disabled={index === cards.length - 1} className="text-faint hover:text-ink disabled:opacity-30" onClick={() => move(index, 1)}>
                <ArrowDown className="size-3.5" />
              </button>
              <button type="button" aria-label={tr('remove_card')} disabled={cards.length === 1} className="text-faint hover:text-ink disabled:opacity-30" onClick={() => onChange(cards.filter((_, i) => i !== index))}>
                <Trash2 className="size-3.5" />
              </button>
            </span>
          </div>
          <TextInput label={tr('card_title', { v0: index + 1 })} value={card.title} maxLength={80} placeholder={tr('card_title_placeholder')} onChange={(title) => change(index, { title })} />
          <TextInput label={tr('card_subtitle', { v0: index + 1 })} value={card.subtitle} maxLength={80} placeholder={tr('card_subtitle_placeholder')} onChange={(subtitle) => change(index, { subtitle })} />
          <TextInput
            label={tr('card_image', { v0: index + 1 })}
            value={card.imageUrl}
            placeholder={tr('https_link_to_a_jpg_or_png')}
            onChange={(imageUrl) => change(index, { imageUrl: imageUrl.trim() })}
            onBlur={(e) => change(index, { imageUrl: normalizeUrl(e.target.value) })}
          />
          <div className="flex items-center gap-2">
            <ButtonField
              label={tr('card_button_label', { v0: index + 1 })}
              icon={<Link2 className="size-3.5 text-brand" />}
              value={card.buttonLabel}
              placeholder={tr('button_label')}
              onChange={(buttonLabel) => change(index, { buttonLabel })}
            />
            <span className="text-faint">→</span>
            <input
              value={card.buttonUrl}
              aria-label={tr('card_link', { v0: index + 1 })}
              placeholder={tr('https')}
              onChange={(e) => change(index, { buttonUrl: e.target.value })}
              onBlur={(e) => change(index, { buttonUrl: normalizeUrl(e.target.value) })}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-muted outline-none placeholder:text-faint"
            />
          </div>
        </div>
      ))}
      {cards.length < MAX_CARDS && (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-muted hover:text-ink"
          onClick={() => onChange([...cards, { ...EMPTY_CARD }])}
        >
          <Plus className="size-3.5" /> {tr('add_card')} ({cards.length}/{MAX_CARDS})
        </button>
      )}
    </div>
  )
}
```

5. Add keys to the `automations` object in both catalogs (put them next to `add_link_button`):

`en.json`:
```json
    "format_links": "Links",
    "format_products": "Product cards",
    "intro_optional": "Intro message (optional)",
    "cardsCount": "{count, plural, one {# product card} other {# product cards}}",
    "cards_hint": "Use square product images. Carousels don’t show on desktop Instagram.",
    "card_n": "Card {v0}",
    "card_title": "Card {v0} title",
    "card_title_placeholder": "Product name",
    "card_subtitle": "Card {v0} subtitle",
    "card_subtitle_placeholder": "Price or a short line (optional)",
    "card_image": "Card {v0} image link",
    "card_button_label": "Card {v0} button label",
    "card_link": "Card {v0} button link",
    "add_card": "Add product card",
    "remove_card": "Remove card",
    "move_card_up": "Move card up",
    "move_card_down": "Move card down",
```

`es.json`:
```json
    "format_links": "Enlaces",
    "format_products": "Tarjetas de producto",
    "intro_optional": "Mensaje de introducción (opcional)",
    "cardsCount": "{count, plural, one {# tarjeta de producto} other {# tarjetas de producto}}",
    "cards_hint": "Usa imágenes de producto cuadradas. Los carruseles no se muestran en Instagram para escritorio.",
    "card_n": "Tarjeta {v0}",
    "card_title": "Título de la tarjeta {v0}",
    "card_title_placeholder": "Nombre del producto",
    "card_subtitle": "Subtítulo de la tarjeta {v0}",
    "card_subtitle_placeholder": "Precio o una frase corta (opcional)",
    "card_image": "Enlace de imagen de la tarjeta {v0}",
    "card_button_label": "Texto del botón de la tarjeta {v0}",
    "card_link": "Enlace del botón de la tarjeta {v0}",
    "add_card": "Añadir tarjeta de producto",
    "remove_card": "Quitar tarjeta",
    "move_card_up": "Subir tarjeta",
    "move_card_down": "Bajar tarjeta",
```

- [ ] **Step 6: Run everything for the web app**

Run: `pnpm --filter @replyooo/web exec vitest run && pnpm --filter @replyooo/web typecheck && pnpm --filter @replyooo/web translations:check`
Expected: all PASS / clean.

- [ ] **Step 7: Check it in a browser**

Start the app the way earlier sessions did (local Postgres container `replyooo-3b-postgres-1`, demo login `demo@replyooo.dev` / `replyooo-demo`), open an Instagram automation, and check:
- the "Links | Product cards" switch appears, and a Facebook account does not show it;
- switching to Product cards shows one empty card; add up to 10, reorder, remove (the last card cannot be removed);
- switching back to Links brings back the links you had typed;
- the phone preview shows the scrollable card row;
- a card link typed without `https://` gets it on blur;
- the editor shows the "Add at least one…" and 80-character issues, and Publish is blocked until they are fixed.
Report what you saw. Do not claim the browser check passed if the preview window could not be opened.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/src/app/(app)/automations/[id]/sections.tsx" "apps/web/src/app/(app)/automations/[id]/editor.tsx" apps/web/src/components/phone-preview.tsx apps/web/src/lib/data/contacts.ts apps/web/messages/en.json apps/web/messages/es.json apps/web/test/phone-preview-localization.test.ts apps/web/test/contacts.test.ts
git commit -m "feat(web): product card editor, preview and timeline text

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs and full verification

**Files:**
- Modify: `docs/competitors/reachlee.md` (carousel row)
- Modify: `docs/superpowers/specs/2026-10-14-product-carousel-design.md` (status line)

- [ ] **Step 1: Update the competitor doc**

In `docs/competitors/reachlee.md`, replace the row `| **Carousel / multi-link DMs** | Yes (Pro) | **No** |` with:

```
| Carousel / multi-link DMs | Yes (Pro) | Yes, "Product cards": up to 10 cards, one link each, Instagram only (built 2026-10-14, not yet deployed) |
```

- [ ] **Step 2: Update the spec status**

Change the spec's second line to `Date: 2026-10-14. Status: approved, implemented on branch feat/product-carousel.` (use the real branch name used for the implementation).

- [ ] **Step 3: Run the full suite**

Run: `pnpm test && pnpm typecheck && pnpm --filter @replyooo/web translations:check`
Expected: all tasks pass, no type errors, translations clean. Quote the final summary lines of each command in the report.

- [ ] **Step 4: Commit**

```bash
git add docs/competitors/reachlee.md docs/superpowers/specs/2026-10-14-product-carousel-design.md
git commit -m "docs: product carousel built

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Hand off the live checks**

The live checks cannot run in tests and need a deployed build plus a real Instagram account. Add them to `~/.claude/projects/-Users-hyyashu-Projects-Replyooo/memory/pending-real-world-tests.md` as a new bullet ("Product carousel: pending live test"): send a real DM carousel of 3 cards from a connected account, confirm it renders and scrolls on a phone, tap each card link and confirm one click per tap in the automation's analytics, check it on Instagram desktop (Meta says it is not shown), and confirm the optional image-less card renders. Do not claim any of this is verified.
