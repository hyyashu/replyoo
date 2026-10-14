# Product carousel: Design

Date: 2026-10-14. Status: design approved in chat, spec awaiting review.

Why this one: Reachlee's Pro plan sends a product carousel in DMs (swipeable cards, each with an image, a title, a price line and a link). We can only send a text message with up to three link buttons. See [../../competitors/reachlee.md](../../competitors/reachlee.md), row "Carousel / multi-link DMs".

## 1. Goal and scope

Let an automation's final message be a carousel of 1 to 10 cards instead of a text message with links. Each card has an image, a title, a short subtitle and one link button. Cards are typed in by hand in the editor.

**In scope (v1)**
- A new flow step, `send_products`, sent as an Instagram generic template.
- A "Links | Product cards" switch on the recipe's final message, with a card list, reordering and a carousel preview.
- Click tracking on every card link, with the same fail-open rule as today (tracking failure never stops a DM).
- Instagram only. Facebook Messenger also has a generic template, but it is not tested here, so Facebook automations keep the text message and the switch is hidden for them.

**Out of scope (v1, see section 7 for phase 2)**
- Importing cards from a product page or from Shopify.
- Prices, catalogs, checkout or payments. The subtitle is free text.
- Reply (postback) buttons on cards, more than one button per card, a card tap action (`default_action`).
- Using a carousel as the first message after a comment, or on ice-breaker answers.
- A reminder (nudge) on a carousel step.

**Success criteria**
- A published automation sends a carousel that renders as a horizontally scrollable generic template on a phone.
- Each card link is tracked: tapping it records a click against the right automation, contact and message, like a link button does today.
- A carousel the editor lets you save is one Meta accepts: limits are enforced before saving, not by a send failure.
- Existing automations and text messages behave exactly as before.

## 2. What Meta allows

Checked on 2026-10-14 against the [Instagram generic template docs](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/generic-template.md):

- `template_type: generic`, up to 10 `elements`. More than one element renders as a horizontally scrollable carousel.
- `title`: required, 80 characters. `subtitle`: optional, 80 characters. `image_url`: optional, no aspect ratio or format rules are stated. At least one property besides `title` must be set.
- `buttons`: up to 3 per element, `web_url` or `postback` only. `default_action`: optional.
- Not available on desktop Instagram.

**Rechecked 2026-10-14 against the [private replies](https://developers.facebook.com/documentation/instagram-platform/private-replies.md), [messaging API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api.md) and [Messenger generic template](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/template/generic) pages:**
- Private replies document only a text `message`. The docs say one message per commenter within 7 days, and follow-ups only after the person replies (then within 24 hours). They do not say whether templates are allowed (our button-template opener is verified live), so a carousel as the first private reply is unverified.
- Sending needs `instagram_business_basic` and `instagram_business_manage_messages`, which we already request. A carousel adds no new permission.
- Instagram's generic template page states no image ratio or format. Messenger's page says photos that are not 1.91:1 are scaled or cropped, and the messaging guide lists image formats png and jpeg (8 MB). We treat 1.91:1 JPG or PNG as the safe choice and do not promise square cards.

**Not confirmed:** whether a generic template may be the first private reply to a comment. The design avoids the question by never sending a carousel as that first message; section 5 enforces it. Whether the 24-hour window rules differ for templates is also not stated, so the carousel is subject to the same rules as any DM.

## 3. Data model

The step, in `packages/shared/src/flow.ts`:

```ts
const ProductCard = z.object({
  title: z.string().trim().min(1).max(80),
  subtitle: z.string().trim().min(1).max(80).optional(),
  imageUrl: HttpUrl.optional(),
  button: z.object({ label: ButtonLabel, url: HttpUrl }),
})

z.object({
  type: z.literal('send_products'),
  /** Optional text sent as its own message just before the carousel. */
  text: MessageText.optional(),
  cards: z.array(ProductCard).min(1).max(10),
  next: StepIdSchema.optional(),
})
```

- `StepSchema` gains the variant, and the loose type enum near `flow.ts:187` gains `'send_products'`.
- Validation (`validate.ts`): the step's `next` takes part in reachability and loop checks like every other step. A comment-triggered flow whose first step is a `send_products` already fails `comment_needs_reply_button` (the first step must be a `send_message` with a reply button), so no new rule is needed for the first-message restriction. A carousel on a Facebook automation raises `platform_unsupported`.
- No database migration. Flows are stored as JSON, and the `messages.body` JSON holds the outbound payload.

## 4. Send path

1. **Engine** (`packages/engine`): `OutboundMessage` gains an optional `cards` array (`title`, `subtitle?`, `imageUrl?`, `button: { label, url }`). `advance` handles `send_products` like `send_message`: when `text` is set it emits that text first as its own message (the same two-message pattern as the existing image-then-text message), then the carousel, then follows `next`. Text rendering (`{{first_name}}` and similar) applies to `text`, titles and subtitles.
2. **Worker** (`apps/worker/src/outbound.ts`): `toSendable` maps a carousel to a new `SendableMessage` kind, `{ kind: 'carousel', cards }`. `withTrackedLinks` also swaps each card's button URL for a tracked link. Tracked-link positions are the card index (one button per card), so they stay stable on retry like button positions do today. On any error the original links are sent.
3. **Meta client** (`packages/meta/src/messages.ts`): `toGraphMessage` gains a `carousel` branch that builds the `generic` template with `web_url` buttons. Titles and subtitles are truncated to 80 characters as a last-resort guard; the editor and schema reject longer text before that.

## 5. Editor

- Recipe (`apps/web/src/lib/recipe.ts`): `message` gains `format: 'links' | 'products'` and `cards: ProductCardInput[]`. `compileRecipe` emits a `send_products` step when `format` is `products`, and `decompileRecipe` reads one back. Card links and images go through `normalizeUrl`, like the links in the text message do.
- Section (`sections.tsx`): the final message section has a "Links | Product cards" switch. Product cards shows a list of 1 to 10 cards, each with an image URL, title, subtitle and button label and link, with move up, move down, remove and add. The existing text and image fields stay for the intro text (the image field is hidden in product mode).
- Preview (`phone-preview.tsx`): a scrollable row of cards in the phone mock.
- Hint under the section: use JPG or PNG images, ideally wide (1.91:1), since Meta may crop other shapes; carousels do not show on desktop Instagram.
- Copy: new keys in `messages/en.json` and `messages/es.json`, checked by `translations:check`.
- The switch is hidden for Facebook accounts, and for ice-breaker triggers (the answers there are text).

## 6. Failure handling

- A card with an unreachable image: Meta decides how that renders. We only validate that it is an http(s) URL, as for the existing image field.
- Meta rejects the template: the message fails with the same reason and `metaMessage` logging as any send failure. The run behaves as it does for a failed text message today.
- A contact on desktop sees nothing useful; this is a Meta limit, so we only note it in the editor.

## 7. Phase 2 (not built here)

Import cards from a product page (Open Graph or JSON-LD data) and from Shopify (many stores expose a public `/products.json`; this is not yet verified, so check it before relying on it). The card shape in section 3 does not change: an importer only fills the same fields the editor edits. Phase 2 gets its own spec.

## 8. Testing

Written test-first.

- `packages/shared`: the schema accepts 1 to 10 cards and rejects 0, 11, an 81-character title or subtitle, and a bad URL; reachability and loop checks include the new step; the first-step comment rule fires for a `send_products` start; a Facebook automation with a carousel is flagged.
- `packages/engine`: `send_products` emits the optional text then the carousel, renders variables, and follows `next`.
- `packages/meta`: `toGraphMessage` builds the expected generic template payload and truncates at 80.
- `apps/worker`: `toSendable` maps the carousel; `withTrackedLinks` swaps each card link and sends the originals if tracking throws; an end-to-end run sends the carousel.
- `apps/web`: `recipe.ts` compile and decompile round-trip for products; the new link normalization; `translations:check` passes.
- Manual, after deploy: a real DM on a phone with a carousel of 3 cards, a link tap recorded once per tap, and an Instagram desktop check to confirm the documented limit.

## 9. Files touched

`packages/shared/src/flow.ts`, `packages/shared/src/validate.ts`, `packages/engine/src/advance.ts`, `packages/engine/src/types.ts`, `packages/meta/src/messages.ts`, `packages/meta/src/types.ts`, `apps/worker/src/outbound.ts`, `apps/web/src/lib/recipe.ts`, `apps/web/src/app/(app)/automations/[id]/sections.tsx`, `apps/web/src/components/phone-preview.tsx`, `apps/web/messages/en.json`, `apps/web/messages/es.json`, plus tests next to each, and `docs/competitors/reachlee.md` (the carousel row, once built).
