# Dashboard localization

Replyooo's authenticated dashboard supports English (`en`) and Spanish (`es`). The language selector is available in Settings, desktop/mobile navigation, Connect, and the shell shown before an account is connected. Each user's selection is independent of their workspace and teammates.

Apply the database migrations before deploying this feature:

```sh
pnpm --filter @replyooo/db db:migrate
```

Migration `0008_fresh_hawkeye.sql` adds the nullable `user.locale` field. Null allows initial browser-language negotiation. Authenticated preferences are read directly from the database so a cached auth session cannot leave the dashboard language stale.

## Locale resolution

`apps/web/src/i18n/request.ts` resolves the request locale in this order:

1. Supported personal preference from the authenticated user.
2. Supported `replyooo_locale` cookie.
3. Supported browser `Accept-Language` tag, honoring quality weights and matching regional tags to a base language.
4. English.

The authenticated language action accepts only a supported language, writes only the signed-in user's preference, and sets its cookie after successful persistence. Cookie changes refresh the server-rendered UI without reloading the document or changing URLs. Providers and editor keys do not depend on locale, preserving unsaved client state and autosave behavior.

Dashboard document language/direction are rendered through a proxy marker and synchronized during client navigation. Excluded public pages retain English. Public pages already read request headers for metadata before this feature.

## Messages and presentation

English and Spanish catalogs live in `apps/web/messages/en.json` and `es.json`. Keys are grouped by feature. Shell/common/error messages are available in the app layout; each feature layout sends its interactive subtree the feature messages it needs. Server Components use `getTranslations`; Client Components use `useTranslations`.

The loader has explicit imports for allowed locales and recursively fills missing messages from English. Catalog validation blocks incomplete release catalogs. Use complete ICU messages with named parameters and plural/select forms; keep business values, statuses, keys, and stored data language independent.

Dashboard formatters use the selected locale, UTC and one request reference time. Currency selection, minor-unit precision, timestamps and billing calculations retain their original semantics. Shared pricing/UI helpers retain English defaults for public callers.

Known legacy action/validation strings are adapted to message codes at dashboard presentation boundaries (`i18n/errors.ts`). Unknown external failures display a translated generic error instead of technical details. Customer messages, automation names, keywords, contact data, and public bio content are never translated.

The phone preview accepts a translation function from the dashboard editor. Public callers use the compact `messages/preview-en.json` default without requiring a dashboard provider. The checker verifies that this default stays consistent with the canonical English shared catalog.

## Verification

```sh
pnpm --filter @replyooo/web translations:check
pnpm --filter @replyooo/web test
pnpm --filter @replyooo/web typecheck
pnpm --filter @replyooo/db test
pnpm --filter @replyooo/db typecheck
pnpm --filter @replyooo/web build
```

The catalog checker validates matching keys, ICU syntax/argument types, and literal message references in source. Dynamic keys also require flow tests and browser inspection. Tests use the existing PostgreSQL Testcontainers harness, so Docker must be running.

Inspect both languages at desktop and phone widths. Check navigation, empty/error states, dates, plurals, connection/billing notices, and keyboard/accessibility labels. Toggle language with unsaved automation and bio edits; confirm fields survive, autosave/conflicts still behave correctly, and customer content remains unchanged. Check the marketing homepage and a feature page to catch regressions in shared components.

## Adding languages toward 90

1. Add a reviewed message catalog with the same semantic keys as English.
2. Add the locale's native name and direction to `i18n/locales.ts`; add an explicit loader in `i18n/catalogs.ts`.
3. Extend the catalog check to the new locale and its ICU argument/plural forms. Keep unreleased locales out of the selectable registry.
4. Verify font coverage, date/number formats, accessibility, and layouts with longer strings.
5. For RTL languages, verify logical spacing, icon/gesture direction, and mixed-direction usernames, URLs and customer messages before enabling the locale. English/Spanish launch does not imply complete RTL support.
6. Enable the locale after review. No dashboard URL or business-schema changes should be needed.

When the selectable language list grows, add a searchable selector. A translation-management service can coordinate catalogs/review without changing component keys. Auth screens, marketing copy, transactional emails, public bio rendering, and external payment/Meta interfaces remain separate localization work.
