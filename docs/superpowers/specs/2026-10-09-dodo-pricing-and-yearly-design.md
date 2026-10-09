# Dodo-sourced pricing, yearly plans and regional prices

Date: 2026-10-09

## Goal

Show visitors the price Dodo Payments will actually charge, including per-country prices (India / INR first, any
country configured in Dodo), and let workspaces buy Pro or Business monthly or yearly.

## Decisions

- Dodo is the source of truth for prices. The site fetches them and caches them; `plans.ts` USD values are only the
  fallback for monthly prices.
- Four Dodo subscription products: Pro monthly, Pro yearly, Business monthly, Business yearly.
- Country comes from Cloudflare's `CF-IPCountry` header. It only changes the displayed price; Dodo decides the charge
  from the billing country we pass at checkout.
- Regional prices use Dodo's `by_country` pricing mode. `by_currency` mode is out of scope.
- Yearly is a Monthly/Yearly toggle (default monthly) on the pricing page, the landing pricing section and
  Settings → Billing, with a "save X%" label computed from the two Dodo prices.
- Existing subscribers can switch freely among all four products through Dodo's change-plan API (prorated).

## Design

### Config
Env vars `DODO_PRODUCT_PRO_MONTHLY`, `DODO_PRODUCT_PRO_YEARLY`, `DODO_PRODUCT_BUSINESS_MONTHLY`,
`DODO_PRODUCT_BUSINESS_YEARLY` replace `DODO_PRODUCT_PRO` / `DODO_PRODUCT_BUSINESS`. `dodoConfig()` returns null
until the API key and all four IDs are set. Update `.env.example`, `deploy/.env.example`, `docker-compose.prod.yml`,
`docs/deploy.md`.

### Prices module (`apps/web/src/lib/billing/pricing.ts`)
- Fetch each product (`GET /products/{id}`: `price.price` in minor units, `price.currency`, `pricing_mode`) and, when
  `pricing_mode` is `by_country`, its localized prices.
- In-memory cache, 1 hour TTL, serve stale on error.
- No cache and Dodo unreachable: monthly falls back to the `plans.ts` USD prices; the yearly toggle is hidden.
- Format with `Intl.NumberFormat` from minor units + currency.
- The localized-price HTTP path and response shape are not in the docs read so far; confirm against a test-mode
  response before implementing.

### Country
Read `CF-IPCountry`. Missing, `XX` or `T1` means base USD. A country with no Dodo rule also shows base USD.
Checkout passes the same country as the billing country (exact checkout field to be confirmed).

### Data model
Migration adds `billing_interval` (`month` | `year`) to `subscriptions`. The webhook maps `product_id` through a
four-entry table to `(plan, interval)` and stores both. `startPlanChange` takes `(plan, interval)` and uses the
matching product for checkout and change-plan. `planForProduct` becomes a `(plan, interval)` lookup.

### UI
- Pricing page and landing pricing section: toggle, per-country price, "save X%".
- Settings → Billing: toggle, current plan and interval highlighted.
- JSON-LD and sitemap keep the USD base price.
- Pages showing a country-specific price are dynamic and send `Cache-Control: private, no-store` so Cloudflare never
  serves one country's HTML to another.

### Errors and tests
A Dodo failure never breaks a page; fallback prices render. Tests: four-product webhook mapping, price selection by
country, cache and stale-on-error, fallback, `startPlanChange` across all four. Update existing billing tests for
the new signatures.

## Out of scope
`by_currency` pricing mode, tax display (Dodo adds tax at checkout), PPP discounts.

## Open items to confirm during implementation
- Dodo localized-prices endpoint path and response fields.
- Dodo checkout field for the billing country.
- Cloudflare SSL mode with Caddy/Traefik at the origin.
