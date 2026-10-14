# Marketing page content

Every public marketing page except the landing, pricing and legal pages is data in this folder. One file per page, one template per folder type, so updating a page means editing one small file.

| Folder | URL | Template |
|---|---|---|
| `features/` | `/features/<slug>` | `components/section-page.tsx` |
| `use-cases/` | `/use-cases/<slug>` | `components/section-page.tsx` |
| `audiences/` | `/for/<slug>` | `components/section-page.tsx` |
| `compare/` | `/compare/<slug>` | `components/compare-page.tsx` |
| `alternatives/` | `/alternatives/<slug>` | `components/compare-page.tsx` |
| `best/` | `/best/<slug>` | `components/best-page.tsx` (round-ups: unranked picks, each with "Good at" and "Watch out for") |
| `tools/` | `/tools/<slug>` | `components/tool-page.tsx`; the tool itself is `components/tools/<tool>-tool.tsx`, picked by the page's `tool` key, with its logic in `lib/tools/` |
| `competitors/` | not a page | facts about one tool, shared by compare and alternatives |

Shared pieces: `types.ts` (page shapes), `shared.ts` (common FAQ answers, `commentTrigger`), `replyooo.ts` (our own numbers, read from the plan catalog), `sections.ts` (registry for the three section folders).

## Add a page
1. Copy a file in the right folder, change the `slug`, text and `updated` date.
2. Import it in that folder's `index.ts` and add it to the array. The route, sitemap and footer pick it up.

## Page metadata
Build a page's metadata with `pageMetadata()` from `lib/metadata.ts`. It sets the canonical URL and the matching `og:url`, and keeps the shared Open Graph image: a page that sets `openGraph` replaces the layout's whole object, so don't set it by hand.

## Add a free tool
1. Write the logic in `lib/tools/<tool>.ts` with tests in `test/tools.test.ts`, and the client component in `components/tools/`.
2. Add its key to `ToolKey` in `types.ts` and to `TOOLS` in `components/tools/index.tsx`.
3. Add the page file in `tools/` and list it in `tools/index.ts`. The `/tools` list, sitemap and footer pick it up.
4. Link it from relevant feature, use-case or audience pages by adding its slug to their `tools` list; they show it in a "Free tools" section.

Tools run only in the browser: no server calls, no stored input. Only state limits and formulas we can back up (Meta's limits come from `@replyooo/shared`).

## Update a competitor price
Edit `competitors/<tool>.ts` (the price lives there once), then bump `checked` and the `updated` date on every `compare/` and `alternatives/` page that mentions it. `sources` lists where the facts came from; it is not shown on the pages.

## Rules for compare, alternatives and best pages
- Only state a competitor fact you read from their own pages. Keep the source in `sources`.
- Say where the competitor is better, and name our own weak spots.
- `updated` feeds the sitemap `lastmod`, so change it only when the content really changes.
- On best pages, mark our tool with `us: true`, say on the page how the tools were compared, and give every pick, ours included, at least one `watchOut`. Don't claim a ranking or testing we didn't do.
- ManyChat's paid prices are deliberately missing (see `competitors/manychat.ts`). Add them once confirmed.
