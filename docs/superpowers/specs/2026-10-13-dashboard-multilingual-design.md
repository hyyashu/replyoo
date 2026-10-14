# Multilingual dashboard

Date: 2026-10-13. Status: approved, implemented and merged to `main`; not yet deployed. Operator notes: [../../dashboard-localization.md](../../dashboard-localization.md).

## Goal

Launch the Replyooo dashboard in English (`en`) and Spanish (`es`), with a shared translation architecture that can expand to 90 reviewed languages. English is the source language and fallback. Additional languages are enabled individually after translation and layout review.

## Scope

Translate the authenticated app shell, Home, Automations and its editor, Contacts, Bio editor, Settings, and Connect. Include shared dashboard components, notices, empty states, confirmation dialogs, accessible labels, and user-facing validation and action errors.

Customer-written messages, automation names, keywords, contact data, and public bio content retain their original values. Marketing pages, authentication screens, transactional emails, public bio rendering, and external billing or Meta pages are outside this release.

## Approach

Use next-intl with request-based locale resolution and no locale URL prefixes. Existing routes, authentication redirects, and Meta callback URLs remain valid. Before implementation, check the installed Next.js documentation and next-intl compatibility with this repository's installed version.

A custom dictionary would require implementing pluralization and server/client integration ourselves. A translation-management service adds operational overhead at this stage. Start with repository-managed catalogs and adopt a service when translation coordination warrants it.

## Catalogs and loading

Keep locale configuration and request resolution in `apps/web/src/i18n/`. Store catalogs in `apps/web/messages/en.json` and `es.json`, grouped into common, navigation, home, automations, contacts, bio, settings, connect, and errors namespaces.

Use stable semantic keys and ICU messages for interpolation and pluralization. Translate complete sentences instead of concatenating translated fragments. Keep internal status values and error codes language independent; translate at the presentation boundary.

Maintain an explicit locale registry with code, native display name, and text direction. Load catalogs through an allowlisted loader, never an arbitrary user-provided import path. Load only the selected language; send client components only the namespaces they need. Merge missing messages from English as a runtime fallback while blocking incomplete launch catalogs in validation.

## Language preference

Add a language selector to Settings and desktop/mobile dashboard navigation. Display English and Español, using language names rather than flags. The selector must also be available when no social account is connected.

Save an optional locale preference on the authenticated user, rather than the workspace, so teammates can use different languages. A validated cookie mirrors the preference for rendering. Resolve locale in this order: saved user preference, supported cookie, browser language, English. Match Spanish regional browser tags to `es` and English regional tags to `en`.

Use an authenticated server action to validate the locale, update the user's preference, set the cookie, and refresh the current page. On failure, retain the previous language and show a translated error. Switching languages must preserve unsaved editor state; verify refresh behavior before integrating the selector into editors.

## Rendering and formatting

Use server translations for Server Components and a dashboard-scoped client provider for interactive components. Resolve one locale for each request so server rendering and hydration agree.

Ensure the dashboard's document language and direction match the selected locale while marketing and other excluded pages retain their current language. Verify the appropriate root-layout or document-attribute strategy against the installed Next.js documentation before implementation.

Use locale-aware number, currency, date, and relative-time formatting. Language selection does not change actual billing currency, stored timestamps, or timezone semantics. Pass a consistent timezone and reference time where needed to avoid hydration differences.

## Expansion to 90 languages

Adding a language requires a catalog, registry entry, supported font coverage, and review. Enable only reviewed locales in the selector. Validate keys, ICU syntax, interpolation parameters, and required plural forms before release.

Use logical spacing and direction-aware layout conventions for changed components. Full RTL support and script-specific font verification are release requirements for each future RTL or additional-script language, not implied by shipping English and Spanish. At larger scale, add a searchable selector and a translation-management workflow without changing component translation keys.

## Delivery sequence

1. Add locale registry, request resolution, catalogs, provider, formatting conventions, and user preference persistence.
2. Translate shell and shared components; add language selectors and account connection notices.
3. Translate Home, Contacts, Bio, Settings, and Connect.
4. Translate Automation lists, templates, editor, validation, and action feedback.
5. Validate completeness and inspect English/Spanish desktop and mobile layouts before release.

## Acceptance and verification

- Both languages cover all in-scope UI, including accessibility labels and error paths.
- Selection persists across navigation, reload, sign-in, and devices through the user preference.
- Users in one workspace can independently select languages.
- Unsupported locale values safely resolve to English; catalog fallback never exposes raw keys.
- Switching language preserves unsaved automation and bio edits.
- Spanish text does not clip navigation, dialogs, tables, or editor controls on mobile or desktop.
- Number/date formatting, plural messages, and server/client rendering agree.
- Customer content, billing behavior, authentication, and Meta callbacks retain their existing semantics.
- Catalog validation, meaningful locale-resolution and preference tests, type checking, and the app build pass. Inspect representative dashboard and editor flows in the shared browser in both languages.

## Planning boundary

This document records the proposed design. Product implementation follows review of this written spec and a separate implementation plan.
