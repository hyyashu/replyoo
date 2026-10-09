# Dodo-sourced pricing, yearly plans and regional prices: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show visitors the price Dodo Payments will charge (per country, INR first), and let workspaces buy or switch between Pro/Business, monthly/yearly.

**Architecture:** Four Dodo products (plan x interval) are configured by env. A small adapter (`dodo-catalog.ts`) is the only code that knows Dodo's product/localized-price response shapes and the checkout billing-country field. `pricing.ts` caches those prices for 1 hour (stale on error, USD fallback), picks a price by `CF-IPCountry`, and builds display data. Webhooks store `(plan, billing_interval)`; `startPlanChange` takes a `(plan, interval)` choice. Pricing UI is a client component with a Monthly/Yearly toggle fed by server-computed prices.

**Tech Stack:** pnpm + Turborepo 2, Next.js 16 (App Router, `apps/web`), Drizzle ORM + drizzle-kit (`packages/db`), zod 4, vitest 5 + msw 3 + testcontainers Postgres.

**Spec:** `docs/superpowers/specs/2026-10-09-dodo-pricing-and-yearly-design.md`

## Global Constraints

- Dodo is the source of truth for prices; `apps/web/src/lib/plans.ts` USD values are only the fallback for monthly prices.
- Env vars `DODO_PRODUCT_PRO_MONTHLY`, `DODO_PRODUCT_PRO_YEARLY`, `DODO_PRODUCT_BUSINESS_MONTHLY`, `DODO_PRODUCT_BUSINESS_YEARLY` replace `DODO_PRODUCT_PRO` / `DODO_PRODUCT_BUSINESS`. `dodoConfig()` returns null until the API key and all four IDs are set.
- Country comes from `CF-IPCountry`. Missing, `XX` or `T1` means base USD. A country with no Dodo rule shows base USD. It only changes the displayed price and the billing country we pass at checkout.
- Only `by_country` pricing mode is honoured; `by_currency` products show their base price. No tax display, no PPP.
- Price cache: in-memory, 1 hour TTL, serve stale on error. No cache and Dodo unreachable: monthly falls back to `plans.ts` USD prices and the yearly toggle is hidden.
- Format with `Intl.NumberFormat` from minor units + currency.
- Monthly/Yearly toggle, default monthly, on `/pricing`, the landing pricing section and Settings → Billing, with a "save X%" label computed from the two Dodo prices.
- Existing subscribers switch among all four products through Dodo change-plan (`proration_billing_mode: 'prorated_immediately'`, as today).
- `subscriptions.billing_interval` is `month` | `year`.
- Toggle default is monthly everywhere. One deliberate exception: in Settings → Billing a yearly subscriber's toggle opens on yearly, so their current card is highlighted on first view (the spec asks for "current plan and interval highlighted").
- JSON-LD and sitemap keep the USD base price (`PLAN_CATALOG`, unchanged).
- Pages showing a country-specific price are dynamic and send `Cache-Control: private, no-store`.
- A Dodo failure never breaks a page.
- Do not touch `turbo.json`. If you must, read the installed Turborepo docs first (see `AGENTS.md`).
- Next.js 16 differs from older versions: before writing page/route code, read the relevant guide under `apps/web/node_modules/next/dist/docs/` (see `apps/web/AGENTS.md`).

## Review Focus

1. **Dodo down on a cold start.** Every page render must not wait on a 15 s timeout. Expect: price fetches use a 3 s timeout, and a failure with no cache is remembered for 60 s (no refetch per request). Test is in Task 4 (`does not refetch for a minute after a failure with no cache`).
2. **Monthly and yearly in different currencies for a country** (e.g. India has an INR rule on Pro monthly but not on Pro yearly). Expect: no "save X%" (never compare INR with USD). Each card still shows its own price. Test is in Task 4 (`yearlySavingsPercent ignores mismatched currencies`).
3. **Zero-decimal and non-USD currencies** (JPY, INR). Expect: `JPY 1200` shows `¥1,200`, not `¥12`. `INR 99900` shows `₹999`. Test is in Task 4 (`formatMoney`).
4. **Yearly subscriber when prices fall back** (toggle hidden, month prices shown). Expect: their card still reads "Your plan". It must not offer "Switch to Pro" that would quietly move them to monthly. Pure helper and test are in Task 7 (`isCurrentCard`).
5. **Same plan, other interval.** A Pro monthly workspace picks Pro yearly. Expect: a change-plan call to the Pro yearly product, not a no-op redirect. Test is in Task 5 (`switches interval on the same plan`).

---

## Facts already gathered from Dodo docs (2026-10-09, verify in Task 0)

Sources: `https://docs.dodopayments.com/llms.txt` → `https://docs.dodopayments.com/_llms/en/api-reference.md`.

- `GET /products/{id}` (`api-reference/products/get-products-1.md`): `price` is a `oneOf` keyed by `type`. `recurring_price` has `price` (int32, minor units), `currency`, `payment_frequency_interval` (`Day|Week|Month|Year`) and `subscription_period_interval`. `pricing_mode` is nullable `by_currency | by_country`. Null means base-only.
- `GET /products/{product_id}/localized-prices` (`api-reference/products/get-products-localized-prices.md`): no query params. The response is `{ items: LocalizedPriceResponse[] }`. Each item has `id`, `product_id`, `mode` (`by_currency|by_country`), `currency`, `amount` (int32, minor units), `country_code` (alpha-2, nullable, set only for `by_country`), `created_at` and `updated_at`. There is no `archived` field in the schema.
- `POST /checkouts` (`developer-resources/checkout-session.md`): optional `billing_address` object. `billing_address.country` is required whenever `billing_address` is sent. Other address fields are optional unless `confirm: true`. The docs do not say which attribute the localized-price matching uses.
- Changelog `v1.106.0`: "matching rule → customer pays exactly the amount you set". The matching attribute is not stated.

---

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `packages/shared/src/plans.ts` | `BILLING_INTERVALS`, `BillingInterval` | 1 |
| `packages/db/src/schema.ts` | `billingIntervalEnum`, `subscriptions.billingInterval` | 1 |
| `packages/db/migrations/0007_billing_interval.sql` (+ `meta/`) | generated migration | 1 |
| `packages/db/test/schema.test.ts` | default interval test | 1 |
| `apps/web/src/lib/data/{types,workspace}.ts` | `Subscription.billedInterval` | 1 |
| `apps/web/src/lib/billing/dodo.ts` | config, product table, request helper, checkout/change-plan/portal calls | 2, 3, 5 |
| `apps/web/src/lib/billing/dodo-catalog.ts` (new) | **the adapter**: product + localized-price fetch/parse, checkout country fields | 3 |
| `apps/web/src/lib/billing/pricing.ts` (new) | country, selection, formatting, savings, cache, display data | 4, 7 |
| `apps/web/src/lib/billing/plan-cards.ts` (new) | pure, client-importable `PlanCard` + `isCurrentCard` | 4, 7 |
| `apps/web/src/lib/billing/sync.ts` | webhook stores plan + interval | 2 |
| `apps/web/src/lib/billing/checkout.ts` | `startPlanChange(config, workspace, choice, options)` | 2 (shim), 5 |
| `apps/web/src/lib/env.ts` | four product env vars | 2 |
| `apps/web/src/lib/plans.ts` | `FALLBACK_MONTHLY_USD_CENTS` | 4 |
| `apps/web/src/app/actions.ts` | `switchPlan` reads `interval` + country | 5 |
| `apps/web/src/components/pricing-cards.tsx` (new, client) | `IntervalToggle`, `PricingCardsView` | 6 |
| `apps/web/src/components/marketing.tsx` | async `PricingCards` server wrapper | 6 |
| `apps/web/src/app/(marketing)/terms/page.tsx` | "monthly or yearly" copy | 6 |
| `apps/web/src/app/(app)/settings/billing-plans.tsx` (new, client) | settings plan grid with toggle | 7 |
| `apps/web/src/app/(app)/settings/page.tsx` | uses `BillingPlans` | 7 |
| `.env.example`, `deploy/.env.example`, `docker-compose.prod.yml`, `docs/deploy.md` | env + setup docs | 2 |
| Tests: `apps/web/test/{billing,billing-webhook,workspace-data,env,pricing}.test.ts` | | 1–7 |

## Order and parallelism

```
Task 0 (research + baseline)            sequential, first
Task 1 (db + shared + getSubscription)  ┐ parallel (disjoint files; Task 3 edits only the
Task 3 (adapter + request helper)       ┘ request helper hunk of dodo.ts, lines 45-64)
Task 2 (env + product table + webhook)  after 1 and 3
Task 4 (pricing.ts)                     after 2
Task 5 (checkout + switchPlan)          ┐ parallel after 4
Task 6 (marketing UI + terms)           ┘
Task 7 (settings UI)                    after 5 and 6 (reuses IntervalToggle, needs interval form field)
Task 8 (verification)                   last
```

Every task ends with `pnpm --filter @replyooo/web test` (or the db package equivalent) green. Tests need Docker running (testcontainers), or `TEST_DATABASE_URL` set.

Commands used throughout (run from repo root `/Users/hyyashu/Projects/Replyooo`):
- One web test file: `pnpm --filter @replyooo/web exec vitest run test/<file>.test.ts`
- All web tests: `pnpm --filter @replyooo/web test`
- DB tests: `pnpm --filter @replyooo/db test`
- Typecheck everything: `pnpm typecheck`
- All tests: `pnpm test`
- There is **no lint script** in this repo (no ESLint/Biome config). Typecheck plus `next build` are the static checks.

---

### Task 0: Confirm the Dodo API details and record a baseline

No product code. The output is a short note added to the top of `apps/web/src/lib/billing/dodo-catalog.ts` when Task 3 creates it. Until then, keep it in the task log or PR description.

A test-mode API key is **not available**, so verify against the docs only.

- [ ] **Step 1: Record the test baseline**

Run: `pnpm test` and `pnpm typecheck`
Write down any test that already fails. For example, `apps/web/test/marketing.test.ts` lists the expected `(marketing)` pages and may be stale after the recent marketing-pages commits. Later tasks must not add failures. Do not fix pre-existing failures as part of this plan unless they block you.

- [ ] **Step 2: Re-read the four Dodo pages and confirm the facts above**

Fetch these and check them against "Facts already gathered" (field names, minor units, nullable `pricing_mode`, `items[].country_code`):
- `https://docs.dodopayments.com/llms.txt` (index)
- `https://docs.dodopayments.com/api-reference/products/get-products-1.md`
- `https://docs.dodopayments.com/api-reference/products/get-products-localized-prices.md`
- `https://docs.dodopayments.com/api-reference/checkout-sessions/create.md`
- `https://docs.dodopayments.com/changelog/v1.106.0.md` and any "localized pricing" guide linked from it

- [ ] **Step 3: Answer these open questions**

Decide each answer from the docs and record it. If the docs are silent, keep the default shown here:
1. Which checkout attribute selects a `by_country` localized price? Default assumption: `billing_address.country`. Adapter output: `{ billing_address: { country } }`.
2. Does `GET .../localized-prices` return archived rules? Default assumption: no.
3. Are amounts for zero-decimal currencies (JPY, KRW) in whole units? Default assumption: yes, following ISO 4217 minor units (`Intl` `maximumFractionDigits`).
4. Does change-plan charge the localized price of the new product for an existing customer? Note the answer in the PR. No code depends on it.
5. Does the Dodo SDK expose these as `client.products.localizedPrices.list`? Informational only. We keep raw `fetch`, as today.

If an answer differs from the default, change **only** `dodo-catalog.ts` and its tests in Task 3. Nothing else may depend on Dodo's response shapes.

- [ ] **Step 4: No commit** (nothing changed).

---

### Task 1: Billing interval in shared, db schema, migration and `getSubscription`

**Files:**
- Modify: `packages/shared/src/plans.ts` (append after `PLAN_NAMES`, line 27)
- Modify: `packages/db/src/schema.ts:50` (enum) and `:368-389` (subscriptions table)
- Create (generated): `packages/db/migrations/0007_billing_interval.sql`, `packages/db/migrations/meta/0007_snapshot.json`, updated `packages/db/migrations/meta/_journal.json`
- Modify: `packages/db/test/schema.test.ts`
- Modify: `apps/web/src/lib/data/types.ts:101-115`, `apps/web/src/lib/data/workspace.ts:85-112`
- Test: `apps/web/test/workspace-data.test.ts:102-145`

**Interfaces:**
- Produces: `BILLING_INTERVALS = ['month', 'year'] as const`, `type BillingInterval = 'month' | 'year'` (from `@replyooo/shared`); `billingIntervalEnum`; column `subscriptions.billingInterval: BillingInterval` (not null, default `'month'`); `Subscription.billedInterval: BillingInterval`.

- [ ] **Step 1: Write the failing db test**

Append to `packages/db/test/schema.test.ts` (add `subscriptions` to the `../src` import list):

```ts
describe('subscriptions.billing_interval', () => {
  it('defaults to month and accepts year', async () => {
    const workspace = one(await db.insert(workspaces).values({ name: 'Interval', ownerUserId: 'user_interval' }).returning())
    const monthly = one(await db.insert(subscriptions).values({ workspaceId: workspace.id, plan: 'pro' }).returning())
    expect(monthly.billingInterval).toBe('month')
    const yearly = one(
      await db.update(subscriptions).set({ billingInterval: 'year' }).where(eq(subscriptions.id, monthly.id)).returning(),
    )
    expect(yearly.billingInterval).toBe('year')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @replyooo/db exec vitest run test/schema.test.ts`
Expected: FAIL. TypeScript/vitest reports that `billingInterval` does not exist, or the value is `undefined`.

- [ ] **Step 3: Add the shared type**

`packages/shared/src/plans.ts`, after `PLAN_NAMES`:

```ts
/** How often a paid plan bills. Each (plan, interval) pair is one Dodo product. */
export const BILLING_INTERVALS = ['month', 'year'] as const
export type BillingInterval = (typeof BILLING_INTERVALS)[number]
```

- [ ] **Step 4: Add the enum and column**

`packages/db/src/schema.ts`: add `BILLING_INTERVALS` to the `@replyooo/shared` import. This is a value import; the existing line is `import type { FlowDefinition } ...`, so add a separate `import { BILLING_INTERVALS } from '@replyooo/shared'`. After `planEnum` (line 50):

```ts
export const billingIntervalEnum = pgEnum('billing_interval', BILLING_INTERVALS)
```

In `subscriptions`, after `plan:`:

```ts
    billingInterval: billingIntervalEnum('billing_interval').notNull().default('month'),
```

- [ ] **Step 5: Generate the migration**

Run: `pnpm --filter @replyooo/db db:generate --name billing_interval`
(drizzle-kit `generate` diffs `src/schema.ts` against `migrations/meta/*_snapshot.json` and needs no database.)
Expected: a new `packages/db/migrations/0007_billing_interval.sql` equal to:

```sql
CREATE TYPE "public"."billing_interval" AS ENUM('month', 'year');--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "billing_interval" "billing_interval" DEFAULT 'month' NOT NULL;
```

You should also get `meta/0007_snapshot.json` and a journal entry with tag `0007_billing_interval`. Existing rows become `month`, which is correct because every current product is monthly. Do not hand-edit the snapshot.

- [ ] **Step 6: Run the db test and confirm it passes**

Run: `pnpm --filter @replyooo/db test`
Expected: PASS (all db tests).

- [ ] **Step 7: Write the failing web test for `billedInterval`**

In `apps/web/test/workspace-data.test.ts`:
- In `'reads the plan, this month’s usage and when usage resets'`, add `billingInterval: 'year'` to the inserted row. Add `billedInterval: 'year',` to the `toEqual` object after `billedPlan: 'pro',`.
- In `'defaults to the free plan with no usage'`, add `billedInterval: 'month',` to the `toMatchObject`.

- [ ] **Step 8: Run it and confirm it fails**

Run: `pnpm --filter @replyooo/web exec vitest run test/workspace-data.test.ts`
Expected: FAIL. `billedInterval` is missing from the received object.

- [ ] **Step 9: Implement**

`apps/web/src/lib/data/types.ts`: import `BillingInterval` from `@replyooo/shared` alongside `PlanKey`, and add to `Subscription` after `billedPlan`:

```ts
  /** Billing period of the subscription row; `month` when there is none. */
  billedInterval: BillingInterval
```

`apps/web/src/lib/data/workspace.ts` `getSubscription`: add `billingInterval: subscriptions.billingInterval,` to the select, and `billedInterval: subscription?.billingInterval ?? 'month',` after `billedPlan` in the return.

- [ ] **Step 10: Run the web tests and typecheck**

Run: `pnpm --filter @replyooo/web test && pnpm typecheck`
Expected: PASS (baseline failures from Task 0 excepted).

- [ ] **Step 11: Commit**

```bash
git add packages/shared/src/plans.ts packages/db/src/schema.ts packages/db/migrations packages/db/test/schema.test.ts apps/web/src/lib/data/types.ts apps/web/src/lib/data/workspace.ts apps/web/test/workspace-data.test.ts
git commit -m "feat(db): store the billing interval of a subscription"
```

---

### Task 2: Four-product config, product table and webhook interval

Runs after Tasks 1 and 3.

**Files:**
- Modify: `apps/web/src/lib/env.ts:23-28`
- Modify: `apps/web/src/lib/billing/dodo.ts:1-33` (types, `dodoConfig`, `planForProduct`)
- Modify: `apps/web/src/lib/billing/sync.ts:52-69`
- Modify: `apps/web/src/lib/billing/checkout.ts:28,34` (temporary monthly shim; Task 5 replaces it)
- Modify: `.env.example:38-46`, `deploy/.env.example:47-52`, `docker-compose.prod.yml:72-73`, `docs/deploy.md` (new subsection)
- Test: `apps/web/test/billing-webhook.test.ts`, `apps/web/test/billing.test.ts:15`, `apps/web/test/env.test.ts`

**Interfaces:**
- Consumes: `BillingInterval` (Task 1).
- Produces (all from `@/lib/billing/dodo`):

```ts
export type PaidPlan = 'pro' | 'business'
export interface PlanChoice { plan: PaidPlan; interval: BillingInterval }
export type ProductTable = Record<PaidPlan, Record<BillingInterval, string>>
export interface DodoConfig { apiKey: string; baseUrl: string; products: ProductTable }
export function dodoConfig(e?: Env): DodoConfig | null
export function planForProduct(products: ProductTable, productId: string): PlanChoice | null
export function productFor(products: ProductTable, choice: PlanChoice): string
export function productIds(products: ProductTable): string[]   // 4 ids, order: pro.month, pro.year, business.month, business.year
export function parsePlanChoice(plan: unknown, interval: unknown): PlanChoice | null
```

- [ ] **Step 1: Write the failing tests**

`apps/web/test/env.test.ts`, add a `describe` (import `dodoConfig` from `@/lib/billing/dodo`):

```ts
describe('dodoConfig', () => {
  const products = {
    DODO_API_KEY: 'key',
    DODO_PRODUCT_PRO_MONTHLY: 'pdt_pm',
    DODO_PRODUCT_PRO_YEARLY: 'pdt_py',
    DODO_PRODUCT_BUSINESS_MONTHLY: 'pdt_bm',
    DODO_PRODUCT_BUSINESS_YEARLY: 'pdt_by',
  }

  it('stays off until the key and all four products are set', () => {
    expect(dodoConfig(parseEnv({ ...base, ...products, DODO_PRODUCT_BUSINESS_YEARLY: '' }))).toBeNull()
    expect(dodoConfig(parseEnv({ ...base, ...products, DODO_API_KEY: '' }))).toBeNull()
    expect(dodoConfig(parseEnv({ ...base, ...products }))).toEqual({
      apiKey: 'key',
      baseUrl: 'https://test.dodopayments.com',
      products: { pro: { month: 'pdt_pm', year: 'pdt_py' }, business: { month: 'pdt_bm', year: 'pdt_by' } },
    })
  })
})
```

`apps/web/test/billing.test.ts`, add (import `parsePlanChoice`, `planForProduct`, `productFor` from `@/lib/billing/dodo`). Also change line 15's `config.products` to the table form `{ pro: { month: 'pdt_pro', year: 'pdt_pro_year' }, business: { month: 'pdt_business', year: 'pdt_business_year' } }`:

```ts
describe('product table', () => {
  it('maps each of the four products to its plan and interval and back', () => {
    for (const plan of ['pro', 'business'] as const) {
      for (const interval of ['month', 'year'] as const) {
        const id = productFor(config.products, { plan, interval })
        expect(planForProduct(config.products, id)).toEqual({ plan, interval })
      }
    }
    expect(planForProduct(config.products, 'pdt_other')).toBeNull()
  })

  it('accepts only known plan and interval form values', () => {
    expect(parsePlanChoice('business', 'year')).toEqual({ plan: 'business', interval: 'year' })
    expect(parsePlanChoice('pro', null)).toEqual({ plan: 'pro', interval: 'month' })
    expect(parsePlanChoice('free', 'month')).toBeNull()
    expect(parsePlanChoice('pro', 'week')).toBeNull()
  })
})
```

`apps/web/test/billing-webhook.test.ts`:
- Replace `PRODUCTS` (line 13) with:

```ts
const PRODUCTS = {
  pro: { month: 'pdt_pro', year: 'pdt_pro_year' },
  business: { month: 'pdt_business', year: 'pdt_business_year' },
}
```
- Replace lines 19-20 with the four env vars:

```ts
process.env.DODO_PRODUCT_PRO_MONTHLY = PRODUCTS.pro.month
process.env.DODO_PRODUCT_PRO_YEARLY = PRODUCTS.pro.year
process.env.DODO_PRODUCT_BUSINESS_MONTHLY = PRODUCTS.business.month
process.env.DODO_PRODUCT_BUSINESS_YEARLY = PRODUCTS.business.year
```
- In `event()`, the default `product_id` becomes `PRODUCTS.pro.month`. Replace every `PRODUCTS.business` with `PRODUCTS.business.month`.
- In `'activates the plan from checkout metadata'`, add `billingInterval: 'month'` to the `toMatchObject`.
- Add:

```ts
  it('stores the interval of each of the four products and follows interval changes', async () => {
    for (const [plan, interval] of [['pro', 'month'], ['pro', 'year'], ['business', 'month'], ['business', 'year']] as const) {
      const { workspaceId } = await createWorkspace(`Four ${plan} ${interval}`)
      const result = await applyDodoEvent(
        db(),
        PRODUCTS,
        event('subscription.active', '2026-10-06T10:00:00.000Z', { workspace_id: workspaceId, subscription_id: `sub_${workspaceId}`, product_id: PRODUCTS[plan][interval] }),
      )
      expect(result).toBe('updated')
      expect(await row(workspaceId)).toMatchObject({ plan, billingInterval: interval })
    }
    const { workspaceId } = await createWorkspace('Goes yearly')
    const sub = `sub_${workspaceId}`
    await applyDodoEvent(db(), PRODUCTS, event('subscription.active', '2026-10-06T10:00:00.000Z', { workspace_id: workspaceId, subscription_id: sub }))
    await applyDodoEvent(db(), PRODUCTS, event('subscription.plan_changed', '2026-10-07T10:00:00.000Z', { subscription_id: sub, product_id: PRODUCTS.pro.year }))
    expect(await row(workspaceId)).toMatchObject({ plan: 'pro', billingInterval: 'year' })
  })
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @replyooo/web exec vitest run test/env.test.ts test/billing.test.ts test/billing-webhook.test.ts`
Expected: FAIL. Type errors or missing exports (`productFor`, `parsePlanChoice`), `dodoConfig` returns null, and `billingInterval` is not stored.

- [ ] **Step 3: Implement env**

`apps/web/src/lib/env.ts`, replace lines 23-28:

```ts
  /** Dodo Payments. Billing is disabled until the key and all four product IDs are set. */
  DODO_API_KEY: optional,
  DODO_WEBHOOK_SECRET: optional,
  DODO_ENVIRONMENT: z.preprocess(blank, z.enum(['test_mode', 'live_mode']).default('test_mode')),
  DODO_PRODUCT_PRO_MONTHLY: optional,
  DODO_PRODUCT_PRO_YEARLY: optional,
  DODO_PRODUCT_BUSINESS_MONTHLY: optional,
  DODO_PRODUCT_BUSINESS_YEARLY: optional,
```

- [ ] **Step 4: Implement the product table in `dodo.ts`**

Replace `dodo.ts` lines 1-33 (keep the request helper and calls below):

```ts
import 'server-only'
import { BILLING_INTERVALS, type BillingInterval } from '@replyooo/shared'
import { type Env, env } from '../env'

export type PaidPlan = 'pro' | 'business'
export interface PlanChoice {
  plan: PaidPlan
  interval: BillingInterval
}
/** One Dodo subscription product per (plan, interval). */
export type ProductTable = Record<PaidPlan, Record<BillingInterval, string>>

export interface DodoConfig {
  apiKey: string
  baseUrl: string
  products: ProductTable
}

export const DODO_BASE_URLS = {
  test_mode: 'https://test.dodopayments.com',
  live_mode: 'https://live.dodopayments.com',
} as const

/** Null until the API key and all four product IDs are set; billing UI and endpoints stay off until then. */
export function dodoConfig(e: Env = env()): DodoConfig | null {
  const { DODO_API_KEY: apiKey, DODO_PRODUCT_PRO_MONTHLY: proMonth, DODO_PRODUCT_PRO_YEARLY: proYear } = e
  const { DODO_PRODUCT_BUSINESS_MONTHLY: businessMonth, DODO_PRODUCT_BUSINESS_YEARLY: businessYear } = e
  if (!apiKey || !proMonth || !proYear || !businessMonth || !businessYear) return null
  return {
    apiKey,
    baseUrl: DODO_BASE_URLS[e.DODO_ENVIRONMENT],
    products: { pro: { month: proMonth, year: proYear }, business: { month: businessMonth, year: businessYear } },
  }
}

const CHOICES: readonly PlanChoice[] = (['pro', 'business'] as const).flatMap((plan) => BILLING_INTERVALS.map((interval) => ({ plan, interval })))

export function productFor(products: ProductTable, choice: PlanChoice): string {
  return products[choice.plan][choice.interval]
}

export function productIds(products: ProductTable): string[] {
  return CHOICES.map((choice) => productFor(products, choice))
}

export function planForProduct(products: ProductTable, productId: string): PlanChoice | null {
  const choice = CHOICES.find((c) => productFor(products, c) === productId)
  return choice ? { ...choice } : null
}

/** Form values from the billing UI; a missing interval means monthly. */
export function parsePlanChoice(plan: unknown, interval: unknown): PlanChoice | null {
  if (plan !== 'pro' && plan !== 'business') return null
  const value = interval ?? 'month'
  if (value !== 'month' && value !== 'year') return null
  return { plan, interval: value }
}
```

- [ ] **Step 5: Store the interval in the webhook**

`apps/web/src/lib/billing/sync.ts`: change the parameter type `products: DodoConfig['products']` to `products: ProductTable`, and import `ProductTable` instead of `DodoConfig`. Then:

```ts
  const choice = planForProduct(products, data.product_id)
  if (!choice) return 'unknown_product'
  ...
  const values = {
    plan: choice.plan,
    billingInterval: choice.interval,
    status: data.status,
    ...
```

- [ ] **Step 6: Keep `checkout.ts` compiling (temporary, monthly only)**

In `apps/web/src/lib/billing/checkout.ts`, import `productFor`. Replace both `config.products[plan]` with `productFor(config.products, { plan, interval: 'month' })`. Task 5 replaces this.

- [ ] **Step 7: Update env examples and deploy docs**

`.env.example` lines 44-46 →

```
# Dodo product IDs: one subscription product per plan and billing period. Prices come from Dodo;
# apps/web/src/lib/plans.ts only holds the USD monthly fallback shown when Dodo is unreachable.
DODO_PRODUCT_PRO_MONTHLY=
DODO_PRODUCT_PRO_YEARLY=
DODO_PRODUCT_BUSINESS_MONTHLY=
DODO_PRODUCT_BUSINESS_YEARLY=
```

`deploy/.env.example` line 47 comment → `# Billing stays off until the key and all four product ids are set. Keep test_mode while testing.` Replace lines 51-52 with the same four `DODO_PRODUCT_*=` lines.

`docker-compose.prod.yml` lines 72-73 →

```yaml
      DODO_PRODUCT_PRO_MONTHLY: ${DODO_PRODUCT_PRO_MONTHLY:-}
      DODO_PRODUCT_PRO_YEARLY: ${DODO_PRODUCT_PRO_YEARLY:-}
      DODO_PRODUCT_BUSINESS_MONTHLY: ${DODO_PRODUCT_BUSINESS_MONTHLY:-}
      DODO_PRODUCT_BUSINESS_YEARLY: ${DODO_PRODUCT_BUSINESS_YEARLY:-}
```

`docs/deploy.md`: add a `### Billing with Dodo Payments (optional)` subsection after `### Google sign-in (optional)` (before `## 5. First live test`):

```markdown
### Billing with Dodo Payments (optional)

Billing stays off until `DODO_API_KEY` and all four product IDs are set.

1. In the Dodo dashboard (test mode first), create four **subscription** products: Pro monthly, Pro yearly,
   Business monthly, Business yearly. The base price is in USD.
2. For a regional price (for example India in INR), open the product, set pricing mode to **By country**, and add a
   rule for the country. Do this on both the monthly and the yearly product, or the yearly "save X%" label is
   hidden for that country. The site reads these prices from Dodo and refreshes them hourly.
3. Put the IDs in `.env` as `DODO_PRODUCT_PRO_MONTHLY`, `DODO_PRODUCT_PRO_YEARLY`, `DODO_PRODUCT_BUSINESS_MONTHLY`,
   `DODO_PRODUCT_BUSINESS_YEARLY`, plus `DODO_API_KEY` and `DODO_ENVIRONMENT` (`test_mode` or `live_mode`).
4. Add a webhook endpoint `<APP_URL>/api/webhooks/dodo` subscribed to `subscription.*` events, and set
   `DODO_WEBHOOK_SECRET` to its signing secret.
5. The visitor's country comes from Cloudflare's `CF-IPCountry` header, so the site must be proxied through
   Cloudflare (orange cloud) for regional prices to show. Without it, everyone sees the USD base price. Pricing pages
   are rendered per request with `Cache-Control: private, no-store`; don't add a Cloudflare cache rule for them.
```

- [ ] **Step 8: Run the tests and typecheck**

Run: `pnpm --filter @replyooo/web test && pnpm typecheck`
Expected: PASS. `apps/web/src/app/api/webhooks/dodo/route.ts` needs no change because it passes `config.products`.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/env.ts apps/web/src/lib/billing/dodo.ts apps/web/src/lib/billing/sync.ts apps/web/src/lib/billing/checkout.ts apps/web/test/env.test.ts apps/web/test/billing.test.ts apps/web/test/billing-webhook.test.ts .env.example deploy/.env.example docker-compose.prod.yml docs/deploy.md
git commit -m "feat(billing): four Dodo products and the billing interval from webhooks"
```

---

### Task 3: Dodo catalog adapter (the only place that knows Dodo's price and checkout-country shapes)

Can run in parallel with Task 1. Edits only the request-helper hunk of `dodo.ts` (lines 45-64).

**Files:**
- Modify: `apps/web/src/lib/billing/dodo.ts:45-64` (generalise `post` to `dodoRequest`)
- Create: `apps/web/src/lib/billing/dodo-catalog.ts`
- Create: `apps/web/test/dodo-catalog.test.ts`

**Interfaces:**
- Consumes: `DodoConfig` (only `apiKey`, `baseUrl`), `DodoError`.
- Produces:

```ts
// dodo.ts
export async function dodoRequest<T>(config: Pick<DodoConfig, 'apiKey' | 'baseUrl'>, method: 'GET' | 'POST', path: string,
  init?: { query?: Record<string, string>; body?: unknown; timeoutMs?: number }): Promise<T>
// dodo-catalog.ts
export interface Money { amount: number; currency: string }           // amount in minor units, ISO 4217 code
export type PricingMode = 'by_country' | 'by_currency' | null
export interface ProductPricing { base: Money; mode: PricingMode; byCountry: Record<string, Money> }  // keys: alpha-2, upper case
export async function fetchProductPricing(config: Pick<DodoConfig, 'apiKey' | 'baseUrl'>, productId: string, timeoutMs?: number): Promise<ProductPricing>
export function checkoutCountryFields(country: string | null): Record<string, unknown>
```

- [ ] **Step 1: Write the failing tests**

`apps/web/test/dodo-catalog.test.ts`:

```ts
import { http, HttpResponse } from 'msw'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { checkoutCountryFields, fetchProductPricing } from '@/lib/billing/dodo-catalog'
import { DodoError } from '@/lib/billing/dodo'
import { mockFetch } from './support'

const DODO = 'https://test.dodopayments.com'
const config = { apiKey: 'dodo_key', baseUrl: DODO }
const server = mockFetch()
beforeEach(() => server.reset())
afterAll(() => server.restore())

const product = (overrides: Record<string, unknown> = {}) => ({
  product_id: 'pdt_pro',
  pricing_mode: null,
  price: { type: 'recurring_price', price: 1200, currency: 'USD', payment_frequency_interval: 'Month', subscription_period_interval: 'Year', payment_frequency_count: 1, subscription_period_count: 10, discount: 0, purchasing_power_parity: false },
  ...overrides,
})

describe('fetchProductPricing', () => {
  it('reads the base price and skips localized prices for a base-only product', async () => {
    const auth: (string | null)[] = []
    server.use(http.get(`${DODO}/products/pdt_pro`, ({ request }) => {
      auth.push(request.headers.get('authorization'))
      return HttpResponse.json(product())
    }))
    expect(await fetchProductPricing(config, 'pdt_pro')).toEqual({ base: { amount: 1200, currency: 'USD' }, mode: null, byCountry: {} })
    expect(auth).toEqual(['Bearer dodo_key'])
  })

  it('collects by_country rules keyed by upper-case country code', async () => {
    server.use(
      http.get(`${DODO}/products/pdt_pro`, () => HttpResponse.json(product({ pricing_mode: 'by_country' }))),
      http.get(`${DODO}/products/pdt_pro/localized-prices`, () =>
        HttpResponse.json({
          items: [
            { id: 'lp_1', product_id: 'pdt_pro', mode: 'by_country', currency: 'INR', amount: 99900, country_code: 'IN', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' },
            { id: 'lp_2', product_id: 'pdt_pro', mode: 'by_currency', currency: 'EUR', amount: 1100, country_code: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' },
          ],
        }),
      ),
    )
    expect(await fetchProductPricing(config, 'pdt_pro')).toEqual({
      base: { amount: 1200, currency: 'USD' },
      mode: 'by_country',
      byCountry: { IN: { amount: 99900, currency: 'INR' } },
    })
  })

  it('turns an unexpected product shape into DodoError', async () => {
    server.use(http.get(`${DODO}/products/pdt_pro`, () => HttpResponse.json({ price: { type: 'recurring_price' } })))
    await expect(fetchProductPricing(config, 'pdt_pro')).rejects.toBeInstanceOf(DodoError)
  })

  it('turns HTTP errors into DodoError with the method in the message', async () => {
    server.use(http.get(`${DODO}/products/pdt_x`, () => HttpResponse.json({ message: 'Not found' }, { status: 404 })))
    await expect(fetchProductPricing(config, 'pdt_x')).rejects.toMatchObject({ status: 404, message: 'Dodo GET /products/pdt_x failed (404): Not found' })
  })
})

describe('checkoutCountryFields', () => {
  it('passes the country as the billing country and nothing when unknown', () => {
    expect(checkoutCountryFields('IN')).toEqual({ billing_address: { country: 'IN' } })
    expect(checkoutCountryFields(null)).toEqual({})
  })
})
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @replyooo/web exec vitest run test/dodo-catalog.test.ts`
Expected: FAIL with "Cannot find module '@/lib/billing/dodo-catalog'".

- [ ] **Step 3: Generalise the request helper in `dodo.ts`**

Replace the `post` function (lines 45-64) with:

```ts
/** One Dodo API call. Errors (network, non-2xx) become DodoError. */
export async function dodoRequest<T>(
  config: Pick<DodoConfig, 'apiKey' | 'baseUrl'>,
  method: 'GET' | 'POST',
  path: string,
  init: { query?: Record<string, string>; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const url = new URL(path, config.baseUrl)
  for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value)
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
    })
  } catch (cause) {
    throw new DodoError(`Dodo request failed: ${(cause as Error).message}`, 0)
  }
  const body = (await response.json().catch(() => ({}))) as { message?: string }
  if (!response.ok) {
    throw new DodoError(`Dodo ${method} ${path} failed (${response.status}): ${body.message ?? response.statusText}`, response.status)
  }
  return body as T
}

const post = <T>(config: DodoConfig, path: string, init: { query?: Record<string, string>; body?: unknown } = {}) =>
  dodoRequest<T>(config, 'POST', path, init)
```

The existing calls to `post(...)` stay unchanged. The existing error-message test (`'Dodo POST /customers/cus_x/customer-portal/session failed (404): Customer not found'`) still holds.

- [ ] **Step 4: Create the adapter**

`apps/web/src/lib/billing/dodo-catalog.ts`:

```ts
import 'server-only'
import { z } from 'zod'
import { type DodoConfig, DodoError, dodoRequest } from './dodo'

/*
 * Everything that depends on Dodo's product/localized-price response shapes and on the checkout field that carries the
 * billing country lives in this file. Checked against docs.dodopayments.com on <date of Task 0>:
 *   GET /products/{id}                      → price.price (minor units), price.currency, pricing_mode (null | by_currency | by_country)
 *   GET /products/{id}/localized-prices     → { items: [{ mode, currency, amount (minor units), country_code }] }
 *   POST /checkouts                         → billing_address.country (alpha-2) selects the by_country price
 * If Dodo differs, correct this file and test/dodo-catalog.test.ts only.
 */

export interface Money {
  /** Minor units of `currency` (cents, paise; whole yen for JPY). */
  amount: number
  currency: string
}
export type PricingMode = 'by_country' | 'by_currency' | null
export interface ProductPricing {
  base: Money
  mode: PricingMode
  /** by_country rules, keyed by upper-case ISO 3166-1 alpha-2 code. */
  byCountry: Record<string, Money>
}

const Mode = z.enum(['by_country', 'by_currency'])
const Product = z.object({
  pricing_mode: Mode.nullish(),
  price: z.object({ price: z.number().int().nonnegative(), currency: z.string().length(3) }),
})
const LocalizedPrices = z.object({
  items: z.array(
    z.object({ mode: Mode, currency: z.string().length(3), amount: z.number().int().nonnegative(), country_code: z.string().length(2).nullish() }),
  ),
})

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new DodoError(`Unexpected Dodo ${what} response`, 200)
  return result.data
}

export async function fetchProductPricing(config: Pick<DodoConfig, 'apiKey' | 'baseUrl'>, productId: string, timeoutMs = 3_000): Promise<ProductPricing> {
  const id = encodeURIComponent(productId)
  const product = parse(Product, await dodoRequest(config, 'GET', `/products/${id}`, { timeoutMs }), 'product')
  const base = { amount: product.price.price, currency: product.price.currency.toUpperCase() }
  const mode = product.pricing_mode ?? null
  const byCountry: Record<string, Money> = {}
  if (mode === 'by_country') {
    const list = parse(LocalizedPrices, await dodoRequest(config, 'GET', `/products/${id}/localized-prices`, { timeoutMs }), 'localized prices')
    for (const item of list.items) {
      if (item.mode === 'by_country' && item.country_code) {
        byCountry[item.country_code.toUpperCase()] = { amount: item.amount, currency: item.currency.toUpperCase() }
      }
    }
  }
  return { base, mode, byCountry }
}

/** Extra POST /checkouts fields that make Dodo charge the visitor's country price. */
export function checkoutCountryFields(country: string | null): Record<string, unknown> {
  return country ? { billing_address: { country } } : {}
}
```

Replace `<date of Task 0>` with the actual date you checked the docs. If Task 0 found a different shape, change the schemas, the paths, `checkoutCountryFields` and the matching test expectations here. Nothing else changes.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm --filter @replyooo/web exec vitest run test/dodo-catalog.test.ts test/billing.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/billing/dodo.ts apps/web/src/lib/billing/dodo-catalog.ts apps/web/test/dodo-catalog.test.ts
git commit -m "feat(billing): read product and localized prices from Dodo"
```

---

### Task 4: Prices module (`pricing.ts`): country, selection, formatting, savings, cache, fallback

Runs after Task 2.

**Files:**
- Create: `apps/web/src/lib/billing/pricing.ts`
- Create: `apps/web/src/lib/billing/plan-cards.ts` (pure, client-importable `PlanCard` type; Task 7 adds `isCurrentCard`)
- Modify: `apps/web/src/lib/plans.ts` (add fallback cents)
- Create: `apps/web/test/pricing.test.ts`
- Modify: `apps/web/test/plans.test.ts`

**Interfaces:**
- Consumes: `fetchProductPricing`, `Money`, `ProductPricing` (Task 3); `DodoConfig`, `PaidPlan`, `ProductTable`, `productFor`, `productIds`, `dodoConfig` (Task 2); `PLAN_CATALOG`.
- Produces (from `@/lib/billing/pricing`):

```ts
export type { Money } from './dodo-catalog'
export function requestCountry(headers: { get(name: string): string | null }): string | null
export function selectPrice(pricing: ProductPricing, country: string | null): Money
export function formatMoney(money: Money): string
export function yearlySavingsPercent(month: Money, year: Money): number | null
export interface PaidPlanPrices { month: Money; year: Money | null; savePercent: number | null }
export interface DisplayPrices { source: 'dodo' | 'fallback'; yearly: boolean; plans: Record<PaidPlan, PaidPlanPrices> }
export async function displayPrices(country: string | null, config?: DodoConfig | null, now?: number): Promise<DisplayPrices>
export function resetPriceCache(): void
export type { PlanCard }   // defined in plan-cards.ts: { key: PlanKey; name; blurb; perks: string[]; featured; month: string; year: string | null; savePercent: number | null }
export function planCards(prices: DisplayPrices): PlanCard[]
export function saveLabel(prices: DisplayPrices): string | null
// plans.ts
export const FALLBACK_MONTHLY_USD_CENTS: Record<'pro' | 'business', number>
```

- [ ] **Step 1: Write the failing tests**

`apps/web/test/plans.test.ts`, add inside the `describe` (import `FALLBACK_MONTHLY_USD_CENTS` from `@/lib/plans` and `formatMoney` from `@/lib/billing/pricing`):

```ts
  it('keeps the display prices in step with the USD fallback', () => {
    for (const key of ['pro', 'business'] as const) {
      expect(formatMoney({ amount: FALLBACK_MONTHLY_USD_CENTS[key], currency: 'USD' })).toBe(PLAN_CATALOG.find((p) => p.key === key)?.price)
    }
  })
```

`apps/web/test/pricing.test.ts`:

```ts
import { http, HttpResponse } from 'msw'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DodoConfig } from '@/lib/billing/dodo'
import {
  displayPrices, formatMoney, planCards, requestCountry, resetPriceCache, saveLabel, selectPrice, yearlySavingsPercent,
} from '@/lib/billing/pricing'
import { mockFetch } from './support'

const DODO = 'https://test.dodopayments.com'
const config: DodoConfig = {
  apiKey: 'dodo_key',
  baseUrl: DODO,
  products: { pro: { month: 'pdt_pm', year: 'pdt_py' }, business: { month: 'pdt_bm', year: 'pdt_by' } },
}
const HOUR = 60 * 60 * 1000
const server = mockFetch()
afterAll(() => server.restore())

type Rule = { country: string; amount: number; currency: string }
const PRODUCTS: Record<string, { amount: number; rules: Rule[] }> = {
  pdt_pm: { amount: 1200, rules: [{ country: 'IN', amount: 99900, currency: 'INR' }] },
  pdt_py: { amount: 12000, rules: [{ country: 'IN', amount: 999900, currency: 'INR' }] },
  pdt_bm: { amount: 2900, rules: [] },
  pdt_by: { amount: 29000, rules: [] },
}
let calls = 0
function dodoUp() {
  server.use(
    http.get(`${DODO}/products/:id`, ({ params }) => {
      calls++
      const p = PRODUCTS[String(params.id)]
      if (!p) return HttpResponse.json({ message: 'nope' }, { status: 404 })
      return HttpResponse.json({ pricing_mode: p.rules.length ? 'by_country' : null, price: { type: 'recurring_price', price: p.amount, currency: 'USD' } })
    }),
    http.get(`${DODO}/products/:id/localized-prices`, ({ params }) =>
      HttpResponse.json({ items: (PRODUCTS[String(params.id)]?.rules ?? []).map((r, i) => ({ id: `lp_${i}`, product_id: params.id, mode: 'by_country', currency: r.currency, amount: r.amount, country_code: r.country, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' })) }),
    ),
  )
}
function dodoDown() {
  server.use(http.get(`${DODO}/products/:id`, () => { calls++; return HttpResponse.json({ message: 'down' }, { status: 503 }) }))
}

beforeEach(() => {
  server.reset()
  resetPriceCache()
  calls = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('requestCountry', () => {
  it('reads CF-IPCountry and treats unknown values as no country', () => {
    expect(requestCountry(new Headers({ 'cf-ipcountry': 'in' }))).toBe('IN')
    for (const value of ['XX', 'T1', '', 'IND', '1N']) expect(requestCountry(new Headers({ 'cf-ipcountry': value }))).toBeNull()
    expect(requestCountry(new Headers())).toBeNull()
  })
})

describe('selectPrice', () => {
  const pricing = { base: { amount: 1200, currency: 'USD' }, mode: 'by_country' as const, byCountry: { IN: { amount: 99900, currency: 'INR' } } }
  it('uses the country rule, else the base price', () => {
    expect(selectPrice(pricing, 'IN')).toEqual({ amount: 99900, currency: 'INR' })
    expect(selectPrice(pricing, 'DE')).toEqual({ amount: 1200, currency: 'USD' })
    expect(selectPrice(pricing, null)).toEqual({ amount: 1200, currency: 'USD' })
  })
  it('ignores rules when the product is not in by_country mode', () => {
    expect(selectPrice({ ...pricing, mode: 'by_currency' }, 'IN')).toEqual({ amount: 1200, currency: 'USD' })
  })
})

describe('formatMoney', () => {
  it('formats minor units for two- and zero-decimal currencies', () => {
    expect(formatMoney({ amount: 1200, currency: 'USD' })).toBe('$12')
    expect(formatMoney({ amount: 1250, currency: 'USD' })).toBe('$12.50')
    expect(formatMoney({ amount: 99900, currency: 'INR' })).toBe('₹999')
    expect(formatMoney({ amount: 1200, currency: 'JPY' })).toBe('¥1,200')
  })
})

describe('yearlySavingsPercent', () => {
  it('rounds down the saving of a year against twelve months, without float error', () => {
    expect(yearlySavingsPercent({ amount: 1200, currency: 'USD' }, { amount: 12000, currency: 'USD' })).toBe(16)
    expect(yearlySavingsPercent({ amount: 1000, currency: 'USD' }, { amount: 9600, currency: 'USD' })).toBe(20)
  })
  it('ignores mismatched currencies and non-savings', () => {
    expect(yearlySavingsPercent({ amount: 99900, currency: 'INR' }, { amount: 12000, currency: 'USD' })).toBeNull()
    expect(yearlySavingsPercent({ amount: 1000, currency: 'USD' }, { amount: 12000, currency: 'USD' })).toBeNull()
  })
})

describe('displayPrices', () => {
  it('shows Dodo prices for the visitor’s country with yearly savings', async () => {
    dodoUp()
    const india = await displayPrices('IN', config, 0)
    expect(india).toMatchObject({ source: 'dodo', yearly: true })
    expect(india.plans.pro).toEqual({ month: { amount: 99900, currency: 'INR' }, year: { amount: 999900, currency: 'INR' }, savePercent: 16 })
    expect(india.plans.business.month).toEqual({ amount: 2900, currency: 'USD' })
    expect((await displayPrices(null, config, 0)).plans.pro.month).toEqual({ amount: 1200, currency: 'USD' })
  })

  it('caches for an hour', async () => {
    dodoUp()
    await displayPrices(null, config, 0)
    const first = calls
    await displayPrices(null, config, HOUR - 1)
    expect(calls).toBe(first)
    await displayPrices(null, config, HOUR + 1)
    expect(calls).toBe(first * 2)
  })

  it('serves stale prices when Dodo fails after expiry', async () => {
    dodoUp()
    await displayPrices(null, config, 0)
    server.reset()
    dodoDown()
    const stale = await displayPrices('IN', config, HOUR + 1)
    expect(stale).toMatchObject({ source: 'dodo', yearly: true })
    expect(stale.plans.pro.month).toEqual({ amount: 99900, currency: 'INR' })
  })

  it('falls back to USD monthly and hides yearly with no cache and Dodo down', async () => {
    dodoDown()
    expect(await displayPrices('IN', config, 0)).toEqual({
      source: 'fallback',
      yearly: false,
      plans: {
        pro: { month: { amount: 1200, currency: 'USD' }, year: null, savePercent: null },
        business: { month: { amount: 2900, currency: 'USD' }, year: null, savePercent: null },
      },
    })
  })

  it('does not refetch for a minute after a failure with no cache', async () => {
    dodoDown()
    await displayPrices(null, config, 0)
    const after = calls
    await displayPrices(null, config, 59_000)
    expect(calls).toBe(after)
    await displayPrices(null, config, 61_000)
    expect(calls).toBeGreaterThan(after)
  })

  it('falls back without calling Dodo when billing is not configured', async () => {
    expect(await displayPrices('IN', null, 0)).toMatchObject({ source: 'fallback', yearly: false })
    expect(calls).toBe(0)
  })
})

describe('planCards and saveLabel', () => {
  it('formats the three plans in the visitor’s currency', async () => {
    dodoUp()
    const prices = await displayPrices('IN', config, 0)
    const cards = planCards(prices)
    expect(cards.map((c) => [c.key, c.month, c.year, c.savePercent])).toEqual([
      ['free', '₹0', '₹0', null],
      ['pro', '₹999', '₹9,999', 16],
      ['business', '$29', '$290', 16],
    ])
    expect(saveLabel(prices)).toBe('Save 16%')
    expect(saveLabel(await displayPrices('IN', null, 0))).toBeNull()
  })
})
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @replyooo/web exec vitest run test/pricing.test.ts test/plans.test.ts`
Expected: FAIL with "Cannot find module '@/lib/billing/pricing'".

- [ ] **Step 3: Add the fallback cents to `plans.ts`**

After `COPY`:

```ts
/** USD monthly prices in cents, shown only when Dodo's prices are unavailable. Keep equal to the Dodo base prices and to COPY. */
export const FALLBACK_MONTHLY_USD_CENTS: Record<'pro' | 'business', number> = { pro: 1200, business: 2900 }
```

Update the `PLAN_CATALOG` doc comment to: `/** Plan copy and USD base prices for JSON-LD, comparison pages and the price fallback. Live prices come from Dodo (lib/billing/pricing.ts). */`

- [ ] **Step 4a: Create the pure card module (no `server-only`, so client components can import from it)**

`apps/web/src/lib/billing/plan-cards.ts`:

```ts
import type { PlanKey } from '@replyooo/shared'

/** One pricing card, ready to render; built on the server by planCards() in pricing.ts. */
export interface PlanCard {
  key: PlanKey
  name: string
  blurb: string
  perks: string[]
  featured: boolean
  /** Formatted price per month. */
  month: string
  /** Formatted price per year; null when yearly is unavailable. */
  year: string | null
  savePercent: number | null
}
```

- [ ] **Step 4b: Implement `pricing.ts`**

```ts
import 'server-only'
import { FALLBACK_MONTHLY_USD_CENTS, PLAN_CATALOG } from '../plans'
import { type DodoConfig, type PaidPlan, dodoConfig, productFor, productIds } from './dodo'
import { type Money, type ProductPricing, fetchProductPricing } from './dodo-catalog'
import type { PlanCard } from './plan-cards'

export type { Money } from './dodo-catalog'
export type { PlanCard } from './plan-cards'

const TTL_MS = 60 * 60 * 1000
const RETRY_MS = 60 * 1000
const PAID: readonly PaidPlan[] = ['pro', 'business']
/** Cloudflare's values for "unknown" and "Tor". */
const NO_COUNTRY = new Set(['XX', 'T1'])

/** Visitor country from Cloudflare, or null for base (USD) prices. */
export function requestCountry(headers: { get(name: string): string | null }): string | null {
  const value = headers.get('cf-ipcountry')?.trim().toUpperCase()
  if (!value || !/^[A-Z]{2}$/.test(value) || NO_COUNTRY.has(value)) return null
  return value
}

/** Only by_country rules are honoured; by_currency products show their base price. */
export function selectPrice(pricing: ProductPricing, country: string | null): Money {
  if (pricing.mode === 'by_country' && country) return pricing.byCountry[country] ?? pricing.base
  return pricing.base
}

function fractionDigits(currency: string): number {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
}

export function formatMoney(money: Money): string {
  const digits = fractionDigits(money.currency)
  const value = money.amount / 10 ** digits
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: money.currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(value)
}

/** Whole percent saved by paying yearly, rounded down; null unless both prices share a currency and yearly is cheaper. */
export function yearlySavingsPercent(month: Money, year: Money): number | null {
  if (month.currency !== year.currency || month.amount <= 0) return null
  // Integer maths: (1 - 0.8) * 100 in floating point is 19.999…, which would floor to 19.
  const twelve = 12 * month.amount
  const percent = Math.floor(((twelve - year.amount) * 100) / twelve)
  return percent > 0 ? percent : null
}

export interface PaidPlanPrices {
  month: Money
  year: Money | null
  savePercent: number | null
}
export interface DisplayPrices {
  source: 'dodo' | 'fallback'
  /** False when yearly prices are unknown: hide the toggle. */
  yearly: boolean
  plans: Record<PaidPlan, PaidPlanPrices>
}

type Catalog = Map<string, ProductPricing>
let cache: { key: string; catalog: Catalog; fetchedAt: number } | null = null
let retryAt = 0
let inflight: Promise<Catalog | null> | null = null

export function resetPriceCache(): void {
  cache = null
  retryAt = 0
  inflight = null
}

async function loadCatalog(config: DodoConfig, now: number): Promise<Catalog | null> {
  const ids = productIds(config.products)
  const key = ids.join(',')
  const usable = cache?.key === key ? cache : null
  if (usable && now - usable.fetchedAt < TTL_MS) return usable.catalog
  if (now < retryAt) return usable?.catalog ?? null
  inflight ??= (async () => {
    try {
      const entries = await Promise.all(ids.map(async (id) => [id, await fetchProductPricing(config, id)] as const))
      cache = { key, catalog: new Map(entries), fetchedAt: now }
      retryAt = 0
      return cache.catalog
    } catch (error) {
      console.error('dodo prices unavailable; serving cached or fallback prices', error)
      retryAt = now + RETRY_MS
      return usable?.catalog ?? null
    } finally {
      inflight = null
    }
  })()
  return inflight
}

function fallbackPrices(): DisplayPrices {
  const plan = (key: PaidPlan): PaidPlanPrices => ({ month: { amount: FALLBACK_MONTHLY_USD_CENTS[key], currency: 'USD' }, year: null, savePercent: null })
  return { source: 'fallback', yearly: false, plans: { pro: plan('pro'), business: plan('business') } }
}

/** Never throws: any Dodo problem yields cached or fallback prices. */
export async function displayPrices(country: string | null, config: DodoConfig | null = dodoConfig(), now = Date.now()): Promise<DisplayPrices> {
  if (!config) return fallbackPrices()
  const catalog = await loadCatalog(config, now)
  if (!catalog) return fallbackPrices()
  const price = (plan: PaidPlan, interval: 'month' | 'year') => {
    const pricing = catalog.get(productFor(config.products, { plan, interval }))
    if (!pricing) throw new Error('price catalog is missing a configured product')
    return selectPrice(pricing, country)
  }
  const plans = Object.fromEntries(
    PAID.map((plan) => {
      const month = price(plan, 'month')
      const year = price(plan, 'year')
      return [plan, { month, year, savePercent: yearlySavingsPercent(month, year) }]
    }),
  ) as Record<PaidPlan, PaidPlanPrices>
  return { source: 'dodo', yearly: true, plans }
}

/** Plan copy from PLAN_CATALOG with prices from `prices`. Free shows zero in the Pro monthly currency. */
export function planCards(prices: DisplayPrices): PlanCard[] {
  const zero = formatMoney({ amount: 0, currency: prices.plans.pro.month.currency })
  return PLAN_CATALOG.map(({ key, name, blurb, perks, featured }) => {
    if (key === 'free') return { key, name, blurb, perks, featured, month: zero, year: prices.yearly ? zero : null, savePercent: null }
    const p = prices.plans[key]
    return { key, name, blurb, perks, featured, month: formatMoney(p.month), year: p.year ? formatMoney(p.year) : null, savePercent: p.savePercent }
  })
}

/** "Save 16%" when both plans save the same, "Save up to 17%" otherwise, null when nothing to show. */
export function saveLabel(prices: DisplayPrices): string | null {
  if (!prices.yearly) return null
  const percents = PAID.map((plan) => prices.plans[plan].savePercent).filter((p): p is number => p !== null)
  if (percents.length === 0) return null
  const max = Math.max(...percents)
  return percents.length === PAID.length && percents.every((p) => p === max) ? `Save ${max}%` : `Save up to ${max}%`
}
```

Note: the `throw` in `price()` can only fire if `productIds` and `productFor` disagree, which is a programming error. The cache key guarantees the catalog holds exactly the configured ids.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm --filter @replyooo/web exec vitest run test/pricing.test.ts test/plans.test.ts`
Expected: PASS. If a `formatMoney` assertion differs only by a narrow no-break space or symbol variant on your Node/ICU, check `node -p "new Intl.NumberFormat('en-US',{style:'currency',currency:'INR'}).format(999)"`. Fix the expectation only if the output is still a sensible price.

- [ ] **Step 6: Run all web tests and typecheck**

Run: `pnpm --filter @replyooo/web test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/billing/pricing.ts apps/web/src/lib/billing/plan-cards.ts apps/web/src/lib/plans.ts apps/web/test/pricing.test.ts apps/web/test/plans.test.ts
git commit -m "feat(billing): cached Dodo prices per country with USD fallback"
```

---

### Task 5: `startPlanChange` across all four products, checkout country, `switchPlan`

Runs after Task 4. Can run in parallel with Task 6.

**Files:**
- Modify: `apps/web/src/lib/billing/dodo.ts` (`createCheckout`: optional `extra` body fields)
- Modify: `apps/web/src/lib/billing/checkout.ts:18-39`
- Modify: `apps/web/src/app/actions.ts:1-10` (imports), `:144-158` (`switchPlan`)
- Test: `apps/web/test/billing.test.ts`

**Interfaces:**
- Consumes: `PlanChoice`, `productFor`, `parsePlanChoice` (Task 2); `checkoutCountryFields` (Task 3); `requestCountry` (Task 4).
- Produces:

```ts
export async function createCheckout(config: DodoConfig, input: { productId: string; workspaceId: string;
  customer: { customerId: string } | { email: string; name: string }; returnUrl: string; extra?: Record<string, unknown> }): Promise<string>
export async function startPlanChange(config: DodoConfig, workspace: { workspaceId: string; user: { email: string; name: string } },
  choice: PlanChoice, options?: { country?: string | null; now?: Date }): Promise<string>
```
- Form contract for Task 7: `switchPlan` reads form fields `plan` (`pro|business`) and `interval` (`month|year`; missing means `month`).

- [ ] **Step 1: Update existing tests to the new signature and add new ones**

In `apps/web/test/billing.test.ts`:
- Replace every `startPlanChange(config, workspace, 'pro')` with `startPlanChange(config, workspace, { plan: 'pro', interval: 'month' })`. Do the same for `'business'`.
- Existing inserts need no `billingInterval`; the column defaults to `month`.
- Add to `describe('startPlanChange')`:

```ts
  it('checks out each of the four products and passes the visitor’s country as billing country', async () => {
    for (const [plan, interval] of [['pro', 'month'], ['pro', 'year'], ['business', 'month'], ['business', 'year']] as const) {
      const workspace = await owner(`Four ${plan} ${interval}`)
      server.reset()
      const calls = capture('post', '/checkouts', { session_id: 'cks_4', checkout_url: 'https://checkout.dodopayments.com/cks_4' })
      await startPlanChange(config, workspace, { plan, interval }, { country: 'IN' })
      expect(calls[0]?.body).toMatchObject({
        product_cart: [{ product_id: config.products[plan][interval], quantity: 1 }],
        billing_address: { country: 'IN' },
      })
    }
  })

  it('switches interval on the same plan', async () => {
    const workspace = await owner('GoYearly')
    const sub = uid('sub')
    await db().insert(subscriptions).values({ workspaceId: workspace.workspaceId, plan: 'pro', billingInterval: 'month', status: 'active', dodoCustomerId: uid('cus'), dodoSubscriptionId: sub })
    const calls = capture('post', `/subscriptions/${sub}/change-plan`, { payment_link: null })
    expect(await startPlanChange(config, workspace, { plan: 'pro', interval: 'year' })).toBe(RETURN)
    expect(calls[0]?.body).toEqual({ product_id: 'pdt_pro_year', quantity: 1, proration_billing_mode: 'prorated_immediately' })
  })

  it('moves a yearly subscriber to another plan’s monthly product', async () => {
    const workspace = await owner('YearlyDown')
    const sub = uid('sub')
    await db().insert(subscriptions).values({ workspaceId: workspace.workspaceId, plan: 'business', billingInterval: 'year', status: 'active', dodoCustomerId: uid('cus'), dodoSubscriptionId: sub })
    const calls = capture('post', `/subscriptions/${sub}/change-plan`, { payment_link: null })
    await startPlanChange(config, workspace, { plan: 'pro', interval: 'month' })
    expect(calls[0]?.body).toMatchObject({ product_id: 'pdt_pro' })
  })
```
- Change `'does nothing for the plan the workspace already pays for'` to insert `billingInterval: 'year'` and call with `{ plan: 'pro', interval: 'year' }`. It still expects `RETURN` and no Dodo call.
- The first test (`'starts a checkout for a workspace without a paid subscription'`) keeps its exact `toEqual` body. No country means no `billing_address`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @replyooo/web exec vitest run test/billing.test.ts`
Expected: FAIL (type error on the new argument shape, or wrong product id / missing `billing_address`).

- [ ] **Step 3: Let `createCheckout` accept extra body fields**

In `dodo.ts`, add `extra?: Record<string, unknown>` to `createCheckout`'s `input` type and spread it last in the body. `dodo.ts` must **not** import `dodo-catalog.ts`; that would create an import cycle, because the adapter imports from `dodo.ts`.

```ts
    body: {
      product_cart: [{ product_id: input.productId, quantity: 1 }],
      customer,
      return_url: input.returnUrl,
      metadata: { workspace_id: input.workspaceId },
      ...input.extra,
    },
```

- [ ] **Step 4: Rewrite `startPlanChange`**

`checkout.ts`:

```ts
import { changeSubscriptionPlan, createCheckout, createPortalSession, type DodoConfig, type PlanChoice, productFor } from './dodo'
import { checkoutCountryFields } from './dodo-catalog'
...
/**
 * Where to send the browser to move a workspace to `choice` (plan + billing interval). One subscription per workspace:
 * a live paid subscription changes product in place (any of the four, prorated); one on hold for a failed payment goes
 * to the customer portal (a new checkout would leave the held subscription to resume later and bill twice); anything
 * else (free, lapsed) gets a new checkout, billed in the visitor's country price when Dodo has one.
 */
export async function startPlanChange(
  config: DodoConfig,
  workspace: { workspaceId: string; user: { email: string; name: string } },
  choice: PlanChoice,
  options: { country?: string | null; now?: Date } = {},
): Promise<string> {
  const now = options.now ?? new Date()
  const productId = productFor(config.products, choice)
  const returnUrl = appUrl('/settings?billing=updated#billing')
  const [current] = await db().select().from(subscriptions).where(eq(subscriptions.workspaceId, workspace.workspaceId))
  if (current?.dodoSubscriptionId && effectivePlan(current, now) !== 'free') {
    if (current.plan === choice.plan && current.billingInterval === choice.interval) return returnUrl
    return (await changeSubscriptionPlan(config, current.dodoSubscriptionId, productId)) ?? returnUrl
  }
  if (current?.dodoSubscriptionId && current.dodoCustomerId && RECOVERABLE_STATUSES.includes(current.status)) {
    return createPortalSession(config, current.dodoCustomerId, appUrl('/settings#billing'))
  }
  return createCheckout(config, {
    productId,
    workspaceId: workspace.workspaceId,
    customer: current?.dodoCustomerId ? { customerId: current.dodoCustomerId } : { email: workspace.user.email, name: workspace.user.name },
    returnUrl,
    extra: checkoutCountryFields(options.country ?? null),
  })
}
```

- [ ] **Step 5: Update `switchPlan`**

`apps/web/src/app/actions.ts`: import `parsePlanChoice` from `@/lib/billing/dodo` and `requestCountry` from `@/lib/billing/pricing`. Add `headers` to the existing `next/headers` import, which already imports `cookies`. Replace the body:

```ts
export async function switchPlan(formData: FormData) {
  const workspace = await requireManager()
  const choice = parsePlanChoice(formData.get('plan'), formData.get('interval'))
  const config = dodoConfig()
  if (!config || !choice) redirect('/settings?billing=unavailable#billing')
  const country = requestCountry(await headers())
  let destination: string
  try {
    destination = await startPlanChange(config, workspace, choice, { country })
  } catch (error) {
    if (!(error instanceof DodoError)) throw error
    console.error('dodo plan change failed', error)
    destination = '/settings?billing=error#billing'
  }
  redirect(destination)
}
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `pnpm --filter @replyooo/web test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/billing/dodo.ts apps/web/src/lib/billing/checkout.ts apps/web/src/app/actions.ts apps/web/test/billing.test.ts
git commit -m "feat(billing): switch among monthly and yearly products and pass the billing country"
```

---

### Task 6: Pricing toggle on `/pricing` and the landing page, plus terms copy

Runs after Task 4. Can run in parallel with Task 5.

Before writing client components, read `apps/web/node_modules/next/dist/docs/01-app/` on Server and Client Components (passing props) and `02-guides/cdn-caching.md` (dynamic pages send `private, no-cache, no-store, max-age=0, must-revalidate`).

**Files:**
- Create: `apps/web/src/components/pricing-cards.tsx` (`'use client'`)
- Modify: `apps/web/src/components/marketing.tsx:1-7` (imports), `:67-98` (`PricingCards`)
- Modify: `apps/web/src/app/(marketing)/terms/page.tsx:31`
- Test: `apps/web/test/pricing.test.ts` (already covers `planCards`/`saveLabel`; no React test runner exists in this repo)

**Interfaces:**
- Consumes: `requestCountry`, `displayPrices`, `planCards`, `saveLabel`, `PlanCard` (Task 4).
- Produces (from `@/components/pricing-cards`, used by Task 7):

```tsx
export function IntervalToggle(props: { value: BillingInterval; onChange: (value: BillingInterval) => void; saveLabel: string | null }): JSX.Element
export function PricingCardsView(props: { cards: PlanCard[]; yearly: boolean; saveLabel: string | null }): JSX.Element
```
- `PricingCards()` in `marketing.tsx` becomes `async`. Callers (`app/(marketing)/page.tsx:221`, `app/(marketing)/pricing/page.tsx:21`) are unchanged.

- [ ] **Step 1: Check that no client component imports `marketing.tsx`**

Run: `grep -rl "use client" apps/web/src | xargs grep -l "components/marketing"`
Expected: no output. `marketing.tsx` will import the server-only pricing module.

- [ ] **Step 2: Create the client component**

`apps/web/src/components/pricing-cards.tsx`:

```tsx
'use client'

import type { BillingInterval } from '@replyooo/shared'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { ButtonLink, cx } from '@/components/ui'
import type { PlanCard } from '@/lib/billing/plan-cards'

export function IntervalToggle({
  value,
  onChange,
  saveLabel,
}: {
  value: BillingInterval
  onChange: (value: BillingInterval) => void
  saveLabel: string | null
}) {
  const option = (interval: BillingInterval, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === interval}
      onClick={() => onChange(interval)}
      className={cx('rounded-full px-4 py-1.5 text-[13.5px] font-semibold', value === interval ? 'bg-ink text-white' : 'text-muted hover:text-ink')}
    >
      {label}
    </button>
  )
  return (
    <div className="inline-flex items-center gap-3">
      <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-full border border-line bg-white p-1">
        {option('month', 'Monthly')}
        {option('year', 'Yearly')}
      </div>
      {saveLabel && <span className="rounded-full bg-lime px-2.5 py-0.5 text-[12px] font-semibold text-ink">{saveLabel}</span>}
    </div>
  )
}

export function PricingCardsView({ cards, yearly, saveLabel }: { cards: PlanCard[]; yearly: boolean; saveLabel: string | null }) {
  const [interval, setBilling] = useState<BillingInterval>('month')
  const showYear = yearly && interval === 'year'
  return (
    <>
      {yearly && (
        <div className="mt-10 flex justify-center">
          <IntervalToggle value={interval} onChange={setBilling} saveLabel={saveLabel} />
        </div>
      )}
      <div className={cx('mx-auto grid max-w-[980px] gap-5 text-left md:grid-cols-3', yearly ? 'mt-8' : 'mt-12')}>
        {cards.map((plan) => (
          <div
            key={plan.key}
            className={cx('flex flex-col rounded-[24px] border p-7', plan.featured ? 'border-ink bg-ink text-white' : 'border-line bg-white')}
          >
            <div className="flex items-center justify-between">
              <span className="text-[16px] font-semibold">{plan.name}</span>
              {plan.featured && <span className="rounded-full bg-lime px-2.5 py-0.5 text-[11px] font-semibold text-ink">Most popular</span>}
            </div>
            <div className="mt-4 font-display text-[44px] leading-none font-bold tracking-[-0.04em]">
              {showYear && plan.year ? plan.year : plan.month}
              <span className={cx('font-sans text-[14px] font-normal tracking-normal', plan.featured ? 'text-white/50' : 'text-subtle')}>
                {showYear && plan.year ? '/year' : '/month'}
              </span>
            </div>
            {showYear && plan.savePercent !== null && (
              <p className={cx('mt-2 text-[12.5px] font-semibold', plan.featured ? 'text-lime' : 'text-green')}>Save {plan.savePercent}%</p>
            )}
            <p className={cx('mt-3 text-[14px]', plan.featured ? 'text-white/60' : 'text-muted')}>{plan.blurb}</p>
            <ButtonLink href="/signup" variant={plan.featured ? 'primary' : 'secondary'} className="mt-6">
              {plan.key === 'free' ? 'Start free' : `Go ${plan.name}`}
            </ButtonLink>
            <ul className="mt-6 flex flex-col gap-2.5 text-[14px]">
              {plan.perks.map((perk) => (
                <li key={perk} className="flex items-center gap-2">
                  <Check className={cx('size-4', plan.featured ? 'text-lime' : 'text-green')} /> {perk}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  )
}
```

- [ ] **Step 3: Make `PricingCards` a server wrapper**

In `marketing.tsx`: remove the `Check` import if nothing else uses it, and remove the `PLAN_CATALOG` import if unused. Add:

```tsx
import { headers } from 'next/headers'
import { PricingCardsView } from '@/components/pricing-cards'
import { displayPrices, planCards, requestCountry, saveLabel } from '@/lib/billing/pricing'
```

Replace `PricingCards` (lines 67-98):

```tsx
/** Prices for the visitor's country (Cloudflare CF-IPCountry); reading headers keeps the page dynamic and uncached. */
export async function PricingCards() {
  const prices = await displayPrices(requestCountry(await headers()))
  return <PricingCardsView cards={planCards(prices)} yearly={prices.yearly} saveLabel={saveLabel(prices)} />
}
```

`softwareApplicationLd(PLAN_CATALOG, siteUrl)` in `pricing/page.tsx` and `freePlan` on the landing page stay as they are, so JSON-LD keeps the USD base price.

- [ ] **Step 4: Terms copy**

`apps/web/src/app/(marketing)/terms/page.tsx:31`: `Paid plans renew monthly until cancelled.` → `Paid plans renew monthly or yearly, depending on the billing period you choose, until cancelled.`

- [ ] **Step 5: Run the tests, typecheck and build**

Run: `pnpm --filter @replyooo/web test && pnpm typecheck && pnpm --filter @replyooo/web build`
Expected: PASS. In the build route table, `/` and `/pricing` must show as dynamic (`ƒ`), not static (`○`).

- [ ] **Step 6: Check by hand in dev**

Run: `pnpm --filter @replyooo/web dev`, then:
- `curl -s http://localhost:3000/pricing | grep -o '\$12'` prints `$12` (no Dodo key locally, so fallback, no toggle).
- `curl -sI http://localhost:3000/pricing | grep -i cache-control` contains `private` and `no-store`.
With a Dodo test key and four test products in `apps/web/.env.local`: `curl -s -H 'cf-ipcountry: IN' http://localhost:3000/pricing | grep -o '₹[0-9,]*'` shows the INR price, if the products have an India rule.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/pricing-cards.tsx apps/web/src/components/marketing.tsx "apps/web/src/app/(marketing)/terms/page.tsx"
git commit -m "feat(web): monthly/yearly toggle and country prices on the pricing sections"
```

---

### Task 7: Settings → Billing toggle with current plan and interval highlighted

Runs after Tasks 5 and 6.

**Files:**
- Create: `apps/web/src/app/(app)/settings/billing-plans.tsx` (`'use client'`)
- Modify: `apps/web/src/app/(app)/settings/page.tsx:1-22` (imports), `:43-56` (data), `:209-262` (renews line + plan grid)
- Modify: `apps/web/src/lib/billing/plan-cards.ts` (add pure `isCurrentCard`), `apps/web/src/lib/billing/pricing.ts` (re-export it)
- Test: `apps/web/test/pricing.test.ts`

**Interfaces:**
- Consumes: `IntervalToggle` (Task 6); `PlanCard` (`plan-cards.ts`, Task 4), `displayPrices`, `planCards`, `saveLabel`, `requestCountry` (Task 4); `switchPlan` form contract `plan` + `interval` (Task 5); `Subscription.billedInterval` (Task 1).
- Produces:

```ts
// plan-cards.ts (re-exported from pricing.ts)
export function isCurrentCard(card: { key: PlanKey }, current: { plan: PlanKey; interval: BillingInterval }, shown: BillingInterval, yearly: boolean): boolean
```

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/pricing.test.ts` (import `isCurrentCard`):

```ts
describe('isCurrentCard', () => {
  it('marks the plan and interval the workspace pays for', () => {
    const pro = { key: 'pro' as const }
    expect(isCurrentCard(pro, { plan: 'pro', interval: 'year' }, 'year', true)).toBe(true)
    expect(isCurrentCard(pro, { plan: 'pro', interval: 'year' }, 'month', true)).toBe(false)
    expect(isCurrentCard({ key: 'free' }, { plan: 'free', interval: 'month' }, 'year', true)).toBe(true)
  })
  it('keeps a yearly plan current when yearly prices are unavailable', () => {
    expect(isCurrentCard({ key: 'pro' }, { plan: 'pro', interval: 'year' }, 'month', false)).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @replyooo/web exec vitest run test/pricing.test.ts`
Expected: FAIL with "isCurrentCard is not a function" or a missing export.

- [ ] **Step 3: Implement `isCurrentCard`**

In `apps/web/src/lib/billing/plan-cards.ts` (no `server-only`, so the client component can import it as a value). Change the import to `import type { BillingInterval, PlanKey } from '@replyooo/shared'` and append:

```ts
/** Free is current regardless of interval; without yearly prices a yearly plan still counts as current. */
export function isCurrentCard(
  card: { key: PlanKey },
  current: { plan: PlanKey; interval: BillingInterval },
  shown: BillingInterval,
  yearly: boolean,
): boolean {
  if (card.key !== current.plan) return false
  return card.key === 'free' || !yearly || current.interval === shown
}
```

In `pricing.ts`, re-export it next to the `PlanCard` type re-export: `export { isCurrentCard } from './plan-cards'`. The test imports it from `@/lib/billing/pricing`.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @replyooo/web exec vitest run test/pricing.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the settings client component**

`apps/web/src/app/(app)/settings/billing-plans.tsx`:

```tsx
'use client'

import type { BillingInterval, PlanKey } from '@replyooo/shared'
import { useState } from 'react'
import { IntervalToggle } from '@/components/pricing-cards'
import { Card, buttonClass, cx } from '@/components/ui'
import { isCurrentCard, type PlanCard } from '@/lib/billing/plan-cards'

export function BillingPlans({
  cards,
  yearly,
  saveLabel,
  current,
  canAct,
  hasBillingAccount,
  switchPlan,
  openBillingPortal,
}: {
  cards: PlanCard[]
  yearly: boolean
  saveLabel: string | null
  current: { plan: PlanKey; interval: BillingInterval }
  canAct: boolean
  hasBillingAccount: boolean
  switchPlan: (formData: FormData) => Promise<void>
  openBillingPortal: () => Promise<void>
}) {
  const [interval, setBilling] = useState<BillingInterval>(yearly && current.plan !== 'free' ? current.interval : 'month')
  const shown: BillingInterval = yearly ? interval : 'month'
  return (
    <>
      {yearly && (
        <div className="mt-4">
          <IntervalToggle value={interval} onChange={setBilling} saveLabel={saveLabel} />
        </div>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {cards.map((plan) => {
          const isCurrent = isCurrentCard(plan, current, shown, yearly)
          const samePlanOtherInterval = plan.key === current.plan && plan.key !== 'free' && !isCurrent
          const price = shown === 'year' && plan.year ? plan.year : plan.month
          return (
            <Card key={plan.key} className={cx('flex flex-col p-5', isCurrent && 'border-ink ring-1 ring-ink')}>
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-semibold">{plan.name}</span>
                {isCurrent && (
                  <span className="rounded-full bg-lime px-2 py-0.5 text-[11px] font-semibold">
                    Current{plan.key !== 'free' ? ` · ${current.interval === 'year' ? 'yearly' : 'monthly'}` : ''}
                  </span>
                )}
              </div>
              <div className="mt-2 font-display text-[30px] font-bold tracking-[-0.04em]">
                {price}
                <span className="font-sans text-[13px] font-normal tracking-normal text-subtle">{shown === 'year' && plan.year ? '/year' : '/month'}</span>
              </div>
              {shown === 'year' && plan.savePercent !== null && <p className="mt-1 text-[12px] font-semibold text-green">Save {plan.savePercent}%</p>}
              <ul className="mt-3 flex flex-col gap-1.5 text-[13px] text-muted">
                {plan.perks.map((perk) => (
                  <li key={perk}>{perk}</li>
                ))}
              </ul>
              {isCurrent ? (
                <button type="button" disabled className={cx(buttonClass('secondary', 'sm'), 'mt-5')}>
                  Your plan
                </button>
              ) : plan.key === 'free' ? (
                canAct && hasBillingAccount ? (
                  <form action={openBillingPortal} className="mt-5 flex">
                    <button type="submit" className={cx(buttonClass('secondary', 'sm'), 'w-full')}>
                      Cancel in billing portal
                    </button>
                  </form>
                ) : (
                  <button type="button" disabled className={cx(buttonClass('secondary', 'sm'), 'mt-5')}>
                    Included
                  </button>
                )
              ) : (
                <form action={switchPlan} className="mt-5 flex">
                  <input type="hidden" name="plan" value={plan.key} />
                  <input type="hidden" name="interval" value={shown} />
                  <button type="submit" disabled={!canAct} className={cx(buttonClass('dark', 'sm'), 'w-full')}>
                    {samePlanOtherInterval ? `Switch to ${shown === 'year' ? 'yearly' : 'monthly'}` : `Switch to ${plan.name}`}
                  </button>
                </form>
              )}
            </Card>
          )
        })}
      </div>
    </>
  )
}
```

- [ ] **Step 6: Use it in the settings page**

In `apps/web/src/app/(app)/settings/page.tsx`:
- Imports: remove `PLAN_CATALOG`. Add `import { headers } from 'next/headers'`, `import { displayPrices, planCards, requestCountry, saveLabel } from '@/lib/billing/pricing'` and `import { BillingPlans } from './billing-plans'`.
- After `const billingEnabled = dodoConfig() !== null` (line 55), add:

```tsx
  const prices = await displayPrices(requestCountry(await headers()))
```
- Renews line (line 211) → `{PLAN_NAMES[subscription.plan]} ({subscription.billedInterval === 'year' ? 'yearly' : 'monthly'}) renews on{' '}`
- Replace the whole `<div className="mt-4 grid gap-4 sm:grid-cols-3">…</div>` block (lines 216-262) with:

```tsx
        <BillingPlans
          cards={planCards(prices)}
          yearly={prices.yearly}
          saveLabel={saveLabel(prices)}
          current={{ plan: subscription.plan, interval: subscription.billedInterval }}
          canAct={manager && billingEnabled}
          hasBillingAccount={subscription.hasBillingAccount}
          switchPlan={switchPlan}
          openBillingPortal={openBillingPortal}
        />
```

- [ ] **Step 7: Run the tests, typecheck and build**

Run: `pnpm --filter @replyooo/web test && pnpm typecheck && pnpm --filter @replyooo/web build`
Expected: PASS. The build succeeds, which proves that no client module imports `server-only` code.

- [ ] **Step 8: Check by hand**

Run `pnpm --filter @replyooo/web dev`, sign in, and open `/settings#billing`. With no Dodo key you should see fallback USD prices, no toggle, and buttons disabled ("Billing isn’t set up yet"). Optionally seed a subscription row with `billing_interval = 'year'` and confirm the Pro card reads "Current · yearly".

- [ ] **Step 9: Commit**

```bash
git add "apps/web/src/app/(app)/settings/billing-plans.tsx" "apps/web/src/app/(app)/settings/page.tsx" apps/web/src/lib/billing/pricing.ts apps/web/src/lib/billing/plan-cards.ts apps/web/test/pricing.test.ts
git commit -m "feat(settings): monthly/yearly plans in billing with the current interval highlighted"
```

---

### Task 8: Verification

**Files:** none (fix-ups only if a check fails).

- [ ] **Step 1: Typecheck the whole monorepo**

Run: `pnpm typecheck`
Expected: every package passes.

- [ ] **Step 2: Lint**

There is no lint script or linter config in this repo (`package.json`, `apps/web/package.json`, `turbo.json` define only `build`, `test`, `typecheck`). Record "no linter configured" and do not add one.

- [ ] **Step 3: Full test run**

Run: `pnpm test` (Docker must be running; Turborepo passes `TEST_DATABASE_URL`, `DOCKER_HOST` and `TESTCONTAINERS_*` through).
Expected: all packages pass except failures recorded as baseline in Task 0.

- [ ] **Step 4: Production build and cache header**

Run: `pnpm --filter @replyooo/web build`, then `pnpm --filter @replyooo/web start` with a minimal env (copy `apps/web/.env.local`).
- `curl -sI http://localhost:3000/ | grep -i cache-control` and the same for `/pricing`: both must contain `private` and `no-store`. Next sends `private, no-cache, no-store, max-age=0, must-revalidate` for dynamic pages.
- If either lacks it, the page was rendered static. Make sure `PricingCards` awaits `headers()` (Task 6, Step 3). As a last resort, add to `apps/web/next.config.ts`:

```ts
  async headers() {
    return ['/', '/pricing'].map((source) => ({ source, headers: [{ key: 'Cache-Control', value: 'private, no-store' }] }))
  },
```

- [ ] **Step 5: Grep for leftovers**

Run: `grep -rnE "DODO_PRODUCT_(PRO|BUSINESS)([^_]|$)" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=docs .`
Expected: no output. `docs/superpowers/plans/2026-10-06-plan-4-*.md` may mention the old names as history. Leave it.

- [ ] **Step 6: Spec open items**

Confirm the PR description lists:
- Task 0 answers: localized-prices path and shape, checkout billing-country field, zero-decimal units, change-plan pricing.
- "Cloudflare SSL mode with Caddy/Traefik at the origin" is still open. It is a deploy step: Full (strict) with Caddy's certificate. It is not code.
- The pending real-world test: a test-mode checkout from an `IN` country shows and charges INR.

- [ ] **Step 7: Commit any verification fix-ups**

```bash
git add -A apps/web packages docs .env.example deploy docker-compose.prod.yml
git commit -m "chore: verification fix-ups for Dodo pricing and yearly plans"
```
(Skip if nothing changed.)
