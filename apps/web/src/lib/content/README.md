# Marketing page content

Every public marketing page except the landing, pricing and legal pages is data in this folder. One file per page, one template per folder type, so updating a page means editing one small file.

| Folder | URL | Template |
|---|---|---|
| `features/` | `/features/<slug>` | `components/section-page.tsx` |
| `use-cases/` | `/use-cases/<slug>` | `components/section-page.tsx` |
| `audiences/` | `/for/<slug>` | `components/section-page.tsx` |
| `compare/` | `/compare/<slug>` | `components/compare-page.tsx` |
| `alternatives/` | `/alternatives/<slug>` | `components/compare-page.tsx` |
| `competitors/` | not a page | facts about one tool, shared by compare and alternatives |

Shared pieces: `types.ts` (page shapes), `shared.ts` (common FAQ answers, `commentTrigger`), `replyooo.ts` (our own numbers, read from the plan catalog), `sections.ts` (registry for the three section folders).

## Add a page
1. Copy a file in the right folder, change the `slug`, text and `updated` date.
2. Import it in that folder's `index.ts` and add it to the array. The route, sitemap and footer pick it up.

## Update a competitor price
Edit `competitors/<tool>.ts` (the price lives there once), then bump `checked` and the `updated` date on every `compare/` and `alternatives/` page that mentions it. `sources` lists where the facts came from; it is not shown on the pages.

## Rules for compare and alternatives pages
- Only state a competitor fact you read from their own pages. Keep the source in `sources`.
- Say where the competitor is better, and name our own weak spots.
- `updated` feeds the sitemap `lastmod`, so change it only when the content really changes.
- ManyChat's paid prices are deliberately missing (see `competitors/manychat.ts`). Add them once confirmed.
