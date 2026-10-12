# Multilingual Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in this session. Steps use checkbox (`- [x]`) syntax for tracking. An alternative subagent-driven workflow requires the user's selection before execution.

**Goal:** Ship the full authenticated dashboard in English and Spanish with persistent personal language selection and catalogs that can expand to 90 languages.

**Architecture:** next-intl resolves a request-scoped locale from the authenticated user's preference, cookie, browser header, and English fallback, in that order. Repository-managed catalogs use semantic keys and ICU messages; server components translate on the server and focused providers supply interactive components. Routes retain their existing URLs.

**Tech Stack:** Next.js 16.3.8 as currently installed, React 19, TypeScript, next-intl, Drizzle/PostgreSQL, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-13-dashboard-multilingual-design.md`

## Global Constraints

- English (`en`) and Spanish (`es`) launch together; English is the source language and fallback.
- Additional languages are enabled individually after translation and layout review.
- Preserve customer-written messages, automation names, keywords, contact data, and public bio content.
- Marketing pages, authentication screens, transactional emails, public bio rendering, and external billing or Meta pages are outside this release.
- No locale URL prefixes; existing authentication redirects and Meta callbacks remain valid.
- Preference belongs to the authenticated user, rather than the workspace.
- Load only the selected catalog, with English fallback; send client components only the namespaces they need.
- Switching language must preserve unsaved automation and bio edits.
- Language does not alter billing currency, stored timestamps, or timezone semantics.
- Read installed Next.js docs before implementation. Read bundled Turborepo docs before changing Turbo commands/config; this plan uses direct workspace commands and does not change Turbo.
- Work on the existing `feat/dashboard-multilingual` branch. Do not create another branch or worktree.

## Review Focus

1. Unsupported, malformed, or weighted browser locales: resolve predictably without crashing or importing arbitrary paths; test in Task 1.
2. A cookie from another user's earlier session: saved preference wins, and one user's preference cannot update another user; test in Task 2.
3. Unsaved drafts and in-flight autosave during switching: preserve editor identity, state, and conflict handling; exercise in Tasks 3 and 6.
4. Shared components used by excluded pages: keep marketing/auth/public bio output English and customer content unchanged; exercise in Tasks 4–6.
5. Server errors and interpolated/plural messages: render translated safe messages with matching parameters and no raw keys or hydration drift; test in Tasks 1, 5, and 6.

## File responsibilities

- `apps/web/src/i18n/locales.ts`: supported registry, locale validation and pure resolution.
- `apps/web/src/i18n/catalogs.ts`: explicit catalog loaders and recursive English fallback.
- `apps/web/src/i18n/request.ts`: next-intl request configuration, request-cached locale, timezone/reference time.
- `apps/web/src/i18n/client-provider.tsx`: focused dashboard namespaces and stable client provider.
- `apps/web/src/i18n/document-language.tsx`: synchronize document attributes on navigation and restore English outside dashboard.
- `apps/web/src/i18n/format.ts`: locale-aware formatting with existing precision/currency semantics.
- `apps/web/src/lib/data/preferences.ts`: database reads/writes of personal locale, independently testable.
- `apps/web/src/app/language-actions.ts`: authentication, validated save, cookie update, stable result codes.
- `apps/web/src/components/language-selector.tsx`: accessible selector and pending/error feedback.
- `apps/web/messages/en.json`, `es.json`: feature-grouped message catalogs.
- `apps/web/scripts/check-translations.ts`: catalog completeness, ICU syntax and argument validation.
- Existing dashboard components/pages: presentation translations; retain business data and internal codes.
- `packages/db/src/schema.ts` and generated migrations: optional personal locale field.

## Task 1: Translation foundation and catalog validation

**Files:** create the `i18n/locales.ts`, `catalogs.ts`, `request.ts`, `format.ts`, catalogs, validation script, and `apps/web/test/i18n.test.ts`; modify `apps/web/next.config.ts`, `apps/web/package.json`, `pnpm-lock.yaml`.

**Interfaces:** `Locale = 'en' | 'es'`; `isLocale(value: unknown): value is Locale`; `resolveLocale(input: {preferred?: string | null; cookie?: string; acceptLanguage?: string}): Locale`; `loadMessages(locale: Locale): Promise<Record<string, unknown>>`. Task 2 supplies the authenticated preference reader. `getDashboardLocale(): Promise<Locale>` is request-cached in `request.ts`. Existing UTC date meaning remains fixed; choose `UTC` for dashboard presentation unless an existing surface explicitly specifies otherwise.

- [x] Read `apps/web/node_modules/next/dist/docs/01-app/02-guides/internationalization.md`, `03-api-reference/04-functions/cookies.md`, and the relevant root-layout/server-client pages. Consult official next-intl App Router configuration docs, check package peer compatibility, then install via `pnpm --filter @replyooo/web add next-intl` and record the resolved version in the lockfile. Add the ICU parser as a direct dev dependency if validation uses its public API.
- [x] Write these behavioral tests before implementing locale resolution:

```ts
expect(resolveLocale({preferred: 'es', cookie: 'en'})).toBe('es')
expect(resolveLocale({cookie: 'es'})).toBe('es')
expect(resolveLocale({acceptLanguage: 'fr;q=1,es-MX;q=0.9,en;q=0.5'})).toBe('es')
expect(resolveLocale({acceptLanguage: 'es;q=0,en;q=1'})).toBe('en')
expect(resolveLocale({preferred: '../../secret', cookie: '__proto__'})).toBe('en')
expect(resolveLocale({acceptLanguage: '%%%'})).toBe('en')
```

- [x] Run `pnpm --filter @replyooo/web exec vitest run test/i18n.test.ts`; confirm failure is the missing implementation. The existing web test harness starts PostgreSQL through Docker; check availability first and report a real environment blocker without replacing integration checks with stubs.
- [x] Implement the explicit registry `{en: {name: 'English', direction: 'ltr'}, es: {name: 'Español', direction: 'ltr'}}`. Parse valid browser tags in descending quality order, ignore `q=0`, match base language, and return English when none match. Use own-property checks for every registry/loader lookup.
- [x] Create allowlisted loaders and recursive fallback, then wrap the existing Next config with the documented next-intl plugin using `./src/i18n/request.ts`. Retain transpile and external-package settings. Request configuration initially resolves cookie/header and is extended with saved preference in Task 2.
- [x] Seed common/navigation messages, including an ICU plural message:

```json
{"common":{"language":"Language","daysLeft":"{count, plural, one {# day left} other {# days left}}"}}
```

- [x] Add catalog checks that compare leaf keys, parse every ICU message, and compare interpolation argument names/types. Verify deliberately removing a Spanish key and renaming a parameter cause failures; verify English fallback renders readable text when a selected message is absent. Add `translations:check` to the web package.
- [x] Run the focused tests, `pnpm --filter @replyooo/web translations:check`, and web typecheck. Commit foundation files with `feat: add dashboard translation foundation`.

## Task 2: Persistent personal language preference

**Files:** modify `packages/db/src/schema.ts`; generate the next numbered migration and metadata through `pnpm --filter @replyooo/db db:generate`; create `lib/data/preferences.ts`, `app/language-actions.ts`, and `test/language-preferences.test.ts`; extend `i18n/request.ts`.

**Interfaces:** add nullable `authUsers.locale: text('locale')`, without a default so existing users can use initial browser negotiation. `getUserLocale(userId: string): Promise<string | null>`; `saveUserLocale(userId: string, locale: Locale): Promise<void>`. `setDashboardLanguage(value: string): Promise<{ok: true} | {ok: false; code: 'invalidLocale' | 'saveFailed'}>` throws/redirects for missing authentication using the existing session convention. Cookie name: `replyooo_locale`; use existing `COOKIE_OPTIONS` plus a one-year max age.

- [x] Write integration tests using the existing `test/support.ts` conventions: new user's preference is null, saved `es` survives a fresh read, changing user A leaves user B unchanged, deleted users are not recreated, and invalid locale input is rejected before persistence. Mock only Next request/cookie APIs for the action boundary, retaining real preference DB tests.
- [x] Run the focused tests and observe the expected missing field/functions failures.
- [x] Add nullable schema field and generate/inspect SQL and migration metadata. Do not manually renumber existing migrations or edit previous migration files. Confirm the migration preserves existing auth data.
- [x] Implement DB access using authenticated server-side user ID; the action accepts only the language, never a client-supplied user ID. Verify update affects an existing row. Return `saveFailed` if persistence fails, set cookie only after persistence, and do not swallow Next redirect exceptions.
- [x] Extend request resolution to query preference from the database using request-cached `getSessionUser()`; avoid relying on Better Auth's cached user object having the custom column. Resolve from saved preference before cookie/header. Translate action result codes on the client.
- [x] Test invalid unauthenticated submissions, DB failure leaving the cookie unchanged, and saved preference overriding a stale cookie. Run auth/schema regression tests, both package typechecks, and commit with `feat: persist dashboard language per user`.

## Task 3: Dashboard provider, language selection and document semantics

**Files:** create `i18n/client-provider.tsx`, `i18n/document-language.tsx`, `components/language-selector.tsx`; modify `app/(app)/layout.tsx`, `components/sidebar.tsx`, `app/(app)/settings/page.tsx`, `app/layout.tsx`, and `src/proxy.ts`.

**Interfaces:** `LanguageSelector` uses the nearest dashboard provider, calls `setDashboardLanguage`, translates result codes, and keeps a stable React identity. Provider receives the request locale, selected namespace messages, fixed timezone/reference time, and children. Never key a provider/editor by locale.

- [x] Pin action success/failure behavior in the action tests: successful changes expose the new request locale; failures keep the prior language and enable retry.
- [x] Integrate a provider for the dashboard shell, including its no-account branch, with common/navigation/error namespaces. Add focused page-level providers for feature namespaces in Tasks 4/5; do not serialize the full catalog into the shell.
- [x] Add a labeled native select displaying English/Español to Settings and both navigation variants. Disable during submission; announce errors through `role="status"`. On success refresh through Next's documented server-action/cookie behavior, using `router.refresh()` only if required by verification. Never use a full page reload.
- [x] For initial document semantics, forward a server-generated dashboard marker from the existing proxy for authenticated page routes and `/connect`, overriding the incoming value. In root layout resolve dashboard locale only when the marker identifies a dashboard page; otherwise render English. Set root `<html lang={locale} dir={direction}>`. Keep API proxy behavior unchanged.
- [x] Verify the installed version's root-layout/rendering behavior. Request headers in root layout can make public pages dynamic: measure build output and public-page response behavior. If unacceptable, stop and revise the document-language design rather than restructuring all routes without review. A nested dashboard container must always have correct `lang`/`dir` for its content.
- [x] Add the dashboard-only document attribute synchronizer for client transitions; restore English on leaving the dashboard. Compare root and provider locale after a refresh and on first Spanish request, and confirm public bio remains English when accessed from a Spanish session.
- [x] Use T3 `preview_status`, then `preview_open` if necessary, to inspect Settings and navigation on desktop/mobile. Change an unsaved automation name and bio detail before toggling language; confirm field content survives. Check language selection with no connected account. Commit with `feat: add dashboard language selection`.

## Task 4: Translate shared UI and dashboard pages

**Files:** modify dashboard Home, Contacts and its drawer/filters/pager/relationship, Bio editor/stats/page, Settings/billing-plans, and the existing Connect page located by `rg --files apps/web/src/app`; modify dashboard uses of `components/ui.tsx`, `confirm-action.tsx`, `verify-banner.tsx`, `workspace-list.tsx`, and `phone-preview.tsx`; expand both catalogs. Add `test/i18n-format.test.ts`.

**Interfaces:** server pages use `getTranslations(namespace)`/`getFormatter()`; client components use `useTranslations(namespace)`/`useFormatter()`. Reusable excluded-page components retain an English default and accept translated label/formatter props from dashboard callers, rather than requiring a dashboard provider globally.

- [x] Inventory visible literals and formatting with `rg -n 'en-US|toLocale|Intl\.|aria-label|placeholder|title=|description=|notice|error' 'apps/web/src/app/(app)' apps/web/src/components`. Include accessibility-only text, plan/status labels, metadata titles, help text and account connection notices.
- [x] Add formatting tests for zero/one/many counts, English/Spanish dates at UTC midnight, currency value/precision preservation, and no accidental thousand-separator changes to user-input values. Use message formatter tests to assert Spanish plural output includes the interpolated number.
- [x] Replace labels with semantic keys in both catalogs; preserve full messages and typed interpolation. For example:

```tsx
const t = await getTranslations('home')
return <PageHeader title={t('title')} subtitle={t('subtitle')} />
// Client equivalent:
const t = useTranslations('contacts')
const format = useFormatter()
return <span>{format.number(contactCount)}</span>
```

- [x] Add focused providers for each page's client subtree. Separate real billing price computation from translated display: pass locale to display formatting while keeping country/currency selection unchanged. Format dates using fixed UTC semantics where currently date-only values occur.
- [x] Translate Bio editor controls and preview chrome without translating preview content or public bio renderer. Translate verify-banner buttons/errors only for dashboard callers. Leave marketing defaults intact in shared UI helpers; opt dashboard callers into locale formatting.
- [x] Run catalog checks, focused formatting tests, existing bio/contacts/pricing tests and typecheck. Inspect English/Spanish Home, Contacts, Bio, Settings, and Connect at 375px and desktop widths, including empty/error states and long text. Commit with `feat: translate dashboard pages into Spanish`.

## Task 5: Automations, templates and action feedback

**Files:** modify every existing `app/(app)/automations` page and client component, relevant dashboard action response paths in `app/actions.ts`, `lib/validation.ts`, `lib/describe.ts`, `lib/recipe.ts`, and dashboard presentation of shared template definitions. Add `src/i18n/errors.ts` and `test/i18n-errors.test.ts`; expand catalog namespaces.

**Interfaces:** introduce presentation-level `DashboardIssue = {code: string; values?: Record<string, string | number>}` for known application validation/action failures; translate with a catalog-backed allowlist. Preserve legacy string responses where non-dashboard callers/tests depend on them, and adapt through known code mappings instead of translating arbitrary English by string replacement. Map unknown external errors to a translated generic message; log technical detail on the server.

- [x] Trace save/publish conflict, missing automation, invalid draft, limits, follow-gate validation, and post-selection error paths. Add failing tests asserting known issue codes render in both languages, unknown codes safely render the generic message, and untrusted error detail is not shown as a raw translation key.
- [x] Translate list/table filters, template descriptions, editor sections, field labels, save/publish status, dialogs and validation messages. Keep persisted template keys, flow schema, execution keywords, and customer messages unchanged. Show translated template descriptions but retain existing content-generation semantics when creating drafts.
- [x] Keep pending/conflict notices as codes/values in client state where feasible, so already-visible feedback changes language immediately. Avoid adding language to autosave dependencies, resetting recipe state, or recreating pending flush state.
- [x] Inventory all user-visible dashboard action feedback beyond automations (bio fields, invitations, disconnect, billing, connection failure); route known errors to translated presentation while preserving business behavior. Update existing tests only where the public response contract intentionally changes and exercise both successful and failing paths.
- [x] Run automation, recipe, validation-related and new error tests, catalog checks, and typecheck. In the shared preview toggle language while editing a message and while autosave runs; verify content, selection, pending state and conflict protection. Publish a deliberately invalid draft to inspect Spanish error feedback. Commit with `feat: translate automation editor and dashboard feedback`.

## Task 6: Release verification and expansion guide

**Files:** create `docs/dashboard-localization.md`; update translation checker where needed; make targeted layout fixes to touched components. Do not enable additional locales in this release.

- [x] Run `pnpm --filter @replyooo/web translations:check`, `pnpm --filter @replyooo/web test`, `pnpm --filter @replyooo/web typecheck`, `pnpm --filter @replyooo/db test`, `pnpm --filter @replyooo/db typecheck`, and `pnpm --filter @replyooo/web build`. Record actual results and blockers. Do not claim build/test success without successful output.
- [x] Repeat the scoped text inventory and inspect remaining English: distinguish customer content, brand/provider names, technical data and excluded flows from missed UI. Confirm metadata titles, aria labels, query-string notices, validation feedback and reconnect banners are covered.
- [x] Verify personal persistence with two users in one workspace, reload, sign-out/sign-in and a second browser session. Test unsupported cookie/header values and an unrecognized saved DB locale. Check redirects and Meta callback URLs retain the same paths.
- [x] Inspect representative English/Spanish screens at 375px and 1280px. Exercise empty Contacts, full tables, billing notices, no-account shell, automation save conflict, and unsaved bio content during switching. Check console/hydration messages and confirm document language on initial load and client navigation.
- [x] Confirm excluded marketing/auth/public bio output and customer-authored content are unchanged. Compare build/public rendering behavior after root-layout header changes; record any intentional rendering tradeoff before shipping.
- [x] Document how to add a locale: translate catalog, add registry/allowlisted loader, validate ICU arguments/plurals, choose font coverage, verify LTR/RTL layout and accessibility, then enable. Include searchable selector and translation-management service as future scaling work, not launch dependencies.
- [x] Commit targeted fixes/docs with `docs: document dashboard localization and verify bilingual release`. Summarize changed behavior, test evidence and any remaining limitations. Create or publish a PR only when requested; if one is created, register it using the T3 PR-linking tool.

## Execution recommendation

Execute inline in the current session. The six tasks share locale, provider, and action interfaces, and the translation pass benefits from preserving whole-dashboard context. Review this plan before product implementation; no product code or dependency changes are part of this planning commit.

## Execution record

Implemented on `feat/dashboard-multilingual`. The translation pass grouped Tasks 3–5 because their catalog/provider/error changes share interfaces. A final independent review identified and the fix pass resolved the public-preview provider regression, a missing technical contact field label, untranslated list trigger descriptions/action errors, and minor placeholder/billing/bio labels. Catalog checking now also catches literal keys missing from both catalogs.

Verified: 250 web tests and 16 database tests passed; web/database typechecks and production build passed. Shared-browser checks covered English/Spanish desktop and 375px layouts, personal preference persistence on navigation/reload, unsaved bio/automation state during switching, translated variable warnings, and English marketing/public bio behavior. Local demo edits used for QA were restored. Migration 0008 must be applied before deployment. RTL/script-specific layout/font verification remains a requirement for future languages.
