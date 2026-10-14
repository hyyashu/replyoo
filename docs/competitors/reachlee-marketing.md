# Reachlee marketing site vs ours

Checked 2026-10-13. Companion to [reachlee.md](reachlee.md) (the product comparison).

**How reliable this is:** page counts come from Reachlee's `sitemap.xml` (331 URLs). Page structure and word counts for two sample pages (`/vs/manychat/`, `/guides/instagram-dm-limits/`) were summarised by a fetch tool, so treat word counts as approximate. We have no traffic or ranking data for either site, so page volume is not evidence that their pages perform. Our counts come from `apps/web/src/lib/content/` and `app/(marketing)/`.

## Size of the two sites

| Section | Reachlee | Replyooo |
|---|---|---|
| Blog | **83 posts** (May 21 to Aug 20, 2026, about 6 a week, bursty: 13 on one day) | none |
| Guides (`/guides/`) | 54 | none |
| Alternatives (`/alternatives/<tool>`) | 43 | 1 (`manychat-alternatives`) |
| `/vs/<tool>` and `/compare/` | 17 + 13 | 4 compare pages (ManyChat, CreatorFlow, InstantDM, ReplyRush) |
| Industry pages (`/for/`) | 19 (salons, restaurants, realtors, gyms, clinics, ...) | 4 (coaches, fitness creators, online shops, photographers and freelancers) |
| Use cases | 24 | 4 |
| Feature pages | 5 | 5 |
| Free tools (`/tools/`) | 22 (calculators and generators) | 4 (DM link generator, UTM link builder, engagement rate calculator, character counter; built 2026-10-15) |
| Best-of lists (`/best/`) | 8 | none |
| How-to (`/how-to/`) | 7 | none |
| AI pages (`/ai/`) | 13 | none (no AI product) |
| Docs (`/docs/`) | 16 | none public (there is a Help link in the app) |
| Core pages | home, about, meta-verified, privacy, terms, data deletion | home, pricing, privacy, terms, data deletion |
| **Total** | **about 331** | **about 30** |

## What their pages look like

- **Compare pages** (about 1,800 to 2,000 words): an 80-word verdict, flat-vs-contact pricing table with a worked example, a feature table (about 17 rows), "why people switch", a migration guide, "the honest bottom line" (concedes where ManyChat wins), about 8 FAQ items, internal link cards. Dated "Updated August 2026".
- **Guides** (about 2,300 to 2,600 words): sourced reference pieces, for example "Instagram DM limits in 2026: every number, with its source", with a limits table, 8 FAQ items, links to four Meta developer pages, a "Human-verified" label and about 50 internal links.
- **Guide topics** are high-intent searches: competitor pricing ("ManyChat pricing", "cancel ManyChat", "LinkDM pricing"), India-specific variants, Meta error codes, the 24-hour window, "why did my automation stop working", "is X safe".
- **Blog** is a single reverse-chronological feed with no categories or search. Titles are mostly "Top 10 ... tools (free, Reddit picks, 2026)", "How to ... in 5 steps" and "Reachlee vs ...". The volume, repeated title patterns and burst publishing suggest scaled or templated content (my inference, not confirmed).
- **Free tools** are small lead magnets: DM link generator, UTM generator, engagement-rate and ROI calculators, caption, hook and bio generators.
- **Positioning:** "flat $9, however big you grow" against contact-based pricing, "built on Meta's official API", "Meta-Verified Tech Provider", and AI-assistant (MCP) docs.
- One inconsistency we saw: a page dated "Updated August 2026" cites a "Sept 2026" price.

## What we have that matches

- One-file-per-page content model (`lib/content/README.md`): adding a page is one file plus one line in an index. The route, sitemap and footer pick it up.
- Honest-comparison rules already written down: only state competitor facts read from their own pages, keep sources, say where the competitor is better, name our weak spots. This is the same style that Reachlee's best pages use.
- Sitemap with real `lastmod` dates, JSON-LD component used on the home, pricing, section and compare pages.

## Gaps, in suggested order

1. **More compare and alternatives pages.** Cheapest win because the model is one file per page. Candidates from their list: LinkDM, Chatfuel, Inro, Linktree/bio tools, Interakt, Tidio, plus "ManyChat pricing" and "cancel ManyChat" style pages. Keep the existing honesty rules.
2. **A guides section on Meta rules**: the 24-hour messaging window, Instagram DM limits, "is automation allowed / will I get banned", common error codes, "why did my automation stop working". High search intent, and our code and the live Meta testing give first-hand material. Cite Meta's docs and add a last-verified date.
3. **A blog**, but fewer and better. They publish 83 posts in 13 weeks; copying that volume is not the goal. Start with about 10 posts that map to what the product does: comment-to-DM setup, collecting emails, follow gate, selling digital products, giveaways, India-specific tool lists.
4. **Industry pages** (`/for/`): we have 4 of their 19. Salons, restaurants, realtors, gyms, clinics and agencies are the obvious additions.
5. **Free tools** as lead magnets. Built 2026-10-15: DM link generator, UTM link builder, engagement rate calculator and character counter (`/tools`). Still open: a DM reply generator, which would need AI or templates, and a QR code for the DM link, which needs a QR library.
6. **Trust pages** once Meta App Review and Business Verification are done: a "Meta-verified" page, an About page, real usage numbers.
7. **Public docs/help**, lowest priority until there are users asking.

AI pages and the AI-assistant (MCP) docs only matter if we build AI features, so skip them for now.

## Caveats before copying anything

- Scaled low-quality content can hurt a site in Google's spam policies. Quality, dated, sourced pages are the part to copy, not the volume.
- Only claim competitor facts we verified from their own pages (our README rule). ManyChat's paid prices are still deliberately missing from `competitors/manychat.ts`.
- Check every Reachlee claim before reusing it. Their usage stats and testimonials are self-reported.
