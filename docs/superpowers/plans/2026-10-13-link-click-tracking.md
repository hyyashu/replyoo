# Link Click Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Count taps on the link buttons of automation DMs and show clicks, unique clickers and click-through rate per automation and per link, on every plan.

**Architecture:** When the worker sends a DM, each `url` button gets a `tracked_links` row and its URL becomes `${APP_URL}/l/<code>`. The web app serves `GET /l/<code>`: it records a `link_clicks` row (skipping bots) and 302-redirects to the real destination. Stats are SQL aggregates over the two tables, surfaced in the automations list, the editor's live-stats bar and a new "Link clicks" section.

**Tech Stack:** TypeScript monorepo (pnpm 10.15, Turborepo), Drizzle ORM 0.45 + drizzle-kit 0.31 on Postgres 18, Hono/BullMQ worker, Next.js 16 app router (route handlers + server actions), Vitest 5 + Testcontainers (Docker must be running).

**Spec:** `docs/superpowers/specs/2026-10-13-link-click-tracking-design.md`

## Global Constraints

- Dev servers only on port **3217** (3000 and 3100 belong to other local projects). `apps/web/.env.local` sets `APP_URL=http://localhost:3217`.
- Tests: `pnpm --filter @replyooo/db test`, `pnpm --filter @replyooo/worker test`, `pnpm --filter @replyooo/web test`. One file: `pnpm --filter <pkg> exec vitest run test/<file>.test.ts`. Each package's test global-setup starts its own Postgres container and applies `packages/db/migrations`, so a new migration is picked up automatically.
- Never use msw `setupServer` in `apps/web` tests (it patches `net.Socket` and breaks Postgres sockets). This plan does not need msw.
- All foreign keys from `tracked_links` are `ON DELETE SET NULL`: deleting an automation, message or contact must never break a link already sitting in someone's DM.
- A tracking failure must never block or change a DM: on any error the worker sends the original URLs.
- Tracking applies only to `url` buttons of `dm` and `private_reply` messages that have a `flowRunId`. Comment replies, images, postback buttons and URLs typed in message text are untouched.
- Link codes are 8 characters of `[0-9A-Za-z]`, generated with `node:crypto`. Anything not matching `^[0-9A-Za-z]{8}$` is a 404 without a database query.
- Stats window is the existing `STATS_WINDOW_DAYS` (30). Recipients and clickers are counted over links **created** in the window, so clickers never exceed recipients.
- End every commit message with: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- Work on branch `feat/link-click-tracking` (already created from `main`).

## Review Focus

1. **Link tapped after its automation, message or contact was deleted:** it still redirects to the destination (clicks keep counting, just unattributed). Pinned in Task 1 ("keeps links working after the automation and contact are deleted").
2. **A DM is retried after a retryable Meta error:** the retry reuses the same codes and creates no duplicate rows. Pinned in Task 2 ("reuses the same codes when a message is retried").
3. **The tracking insert fails:** the DM still goes out with the original URLs and a warning is logged. Pinned in Task 2 ("falls back to the original links when tracking fails").
4. **A link scanner, bot, `HEAD` request or request with no user agent hits the link:** the visitor is still redirected, but no click is recorded. Pinned in Task 3.
5. **A malformed code or a stored non-http(s) destination such as `javascript:`:** 404, never a redirect. Pinned in Task 3.
6. **No one has been sent a link yet (or only failed sends):** CTR shows "—", never `NaN%` or a click rate above 100%. Pinned in Task 1 (cohort test) and Task 4.

---

## File Structure

| Path | Responsibility |
|---|---|
| `packages/db/src/schema.ts` | + `trackedLinks`, `linkClicks` tables |
| `packages/db/migrations/0008_link_click_tracking.sql` (+ `meta/`) | Generated migration |
| `packages/db/src/link-codes.ts` | `generateLinkCode()`, `isLinkCode()` |
| `packages/db/src/queries.ts` | + `createTrackedLinks`, `getTrackedLink`, `recordLinkClick`, `linkStatsByAutomation`, `automationLinkInsights`, `automationLinkDaily` |
| `packages/db/src/index.ts` | + export `link-codes` |
| `packages/db/test/link-tracking.test.ts` | DB-level tests |
| `apps/worker/src/outbound.ts` | + `withTrackedLinks()` and its use in `handleOutbound` |
| `apps/worker/test/outbound.test.ts` | Updated URL expectation + new tracking tests |
| `apps/web/src/lib/bots.ts` | `isBotUserAgent` (moved from `lib/bio.ts`) |
| `apps/web/src/app/l/[code]/route.ts` | Public redirect + click recording |
| `apps/web/src/app/robots.ts` | + disallow `/l/` |
| `apps/web/src/lib/data/types.ts` | `AutomationStats` + `recipients`, `clickers` |
| `apps/web/src/lib/data/automations.ts` | Stats merge, `linkInsights()`, `linkDaily()` |
| `apps/web/src/app/actions.ts` | + `getLinkInsights`, `getLinkDaily` server actions |
| `apps/web/src/app/(app)/automations/automations-table.tsx` | + "Click rate" column |
| `apps/web/src/app/(app)/automations/[id]/editor.tsx` | + metrics in the live-stats bar, + `<LinkInsights />` |
| `apps/web/src/app/(app)/automations/[id]/link-insights.tsx` | "Link clicks" section |
| `apps/web/test/link-redirect.test.ts`, `link-insights.test.ts` | Web tests |
| `docs/superpowers/specs/2026-10-13-link-click-tracking-design.md` | Stats definition tweak (Task 1) |

---

### Task 1: Database tables, link codes and queries

**Files:**
- Modify: `packages/db/src/schema.ts` (append after `bioEvents`)
- Create: `packages/db/src/link-codes.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/queries.ts` (imports at the top, new section at the end)
- Create (generated): `packages/db/migrations/0008_link_click_tracking.sql`, updated `packages/db/migrations/meta/*`
- Test: `packages/db/test/link-tracking.test.ts`
- Modify: `docs/superpowers/specs/2026-10-13-link-click-tracking-design.md` (§3 Stats)

**Interfaces:**
- Consumes: existing `id()`, `tz()` helpers in `schema.ts`; `Db | Tx` from `./client`.
- Produces (all exported from `@replyooo/db`):
  - `trackedLinks`, `linkClicks` Drizzle tables.
  - `generateLinkCode(): string`, `isLinkCode(value: string): boolean`, `LINK_CODE_LENGTH = 8`.
  - `createTrackedLinks(db, { messageId, contactId, automationId, links: { position: number; url: string }[] }): Promise<Map<number, string>>`: codes by button position; idempotent per `(messageId, position)`.
  - `getTrackedLink(db, code): Promise<{ id: string; url: string } | null>`
  - `recordLinkClick(db, linkId): Promise<void>`
  - `linkStatsByAutomation(db, automationIds: string[], since: Date): Promise<Map<string, { recipients: number; clickers: number }>>`
  - `interface LinkInsight { url: string; recipients: number; clickers: number; clicks: number }`
  - `automationLinkInsights(db, automationId, since: Date): Promise<LinkInsight[]>`
  - `automationLinkDaily(db, automationId, url, days = 14): Promise<{ day: string; clicks: number }[]>`

- [ ] **Step 1: Write the failing tests**

Create `packages/db/test/link-tracking.test.ts`:

```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { FlowDefinition } from '@replyooo/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../src'
import {
  automationLinkDaily,
  automationLinkInsights,
  automations,
  connectedAccounts,
  contacts,
  createDb,
  createTrackedLinks,
  generateLinkCode,
  getTrackedLink,
  isLinkCode,
  linkClicks,
  linkStatsByAutomation,
  messages,
  recordLinkClick,
  trackedLinks,
  workspaces,
} from '../src'

let container: StartedPostgreSqlContainer | undefined
let db: Db
let close: () => Promise<void>

beforeAll(async () => {
  let url = process.env.TEST_DATABASE_URL
  if (!url) {
    container = await new PostgreSqlContainer('postgres:18-alpine').start()
    url = container.getConnectionUri()
  }
  const created = createDb(url)
  db = created.db
  close = created.close
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) })
})

afterAll(async () => {
  await close?.()
  await container?.stop()
})

const flow: FlowDefinition = {
  trigger: { type: 'any_dm' },
  start: 's1',
  steps: { s1: { type: 'send_message', text: 'hi' } },
}

async function seed() {
  const tag = randomUUID().slice(0, 8)
  const [workspace] = await db.insert(workspaces).values({ name: 'Acme', ownerUserId: 'x' }).returning()
  const [account] = await db
    .insert(connectedAccounts)
    .values({ workspaceId: workspace!.id, platform: 'instagram', externalId: `ig_${tag}`, username: 'maya.makes', accessTokenEnc: 'x' })
    .returning()
  const [automation] = await db
    .insert(automations)
    .values({ workspaceId: workspace!.id, connectedAccountId: account!.id, name: 'Test', triggerType: 'any_dm', definition: flow })
    .returning()
  const contact = async (n: number) =>
    (
      await db
        .insert(contacts)
        .values({ workspaceId: workspace!.id, connectedAccountId: account!.id, platformUserId: `psid_${tag}_${n}` })
        .returning()
    )[0]!
  const message = async (contactId: string, status: 'sent' | 'failed' | 'queued' = 'sent') =>
    (
      await db
        .insert(messages)
        .values({
          contactId,
          connectedAccountId: account!.id,
          direction: 'out',
          kind: 'dm',
          body: { type: 'message', message: { text: 'hi' } },
          status,
        })
        .returning()
    )[0]!
  /** A tracked link for one sent (or failed) message to `contactId`. */
  const link = async (contactId: string, url: string, status: 'sent' | 'failed' = 'sent') => {
    const sent = await message(contactId, status)
    const codes = await createTrackedLinks(db, {
      messageId: sent.id,
      contactId,
      automationId: automation!.id,
      links: [{ position: 0, url }],
    })
    const code = codes.get(0)!
    const row = (await getTrackedLink(db, code))!
    return { ...row, code, messageId: sent.id }
  }
  return { automationId: automation!.id, contact, message, link }
}

const longAgo = new Date(Date.now() - 60 * 86_400_000)
const lastMonth = () => new Date(Date.now() - 30 * 86_400_000)

describe('link codes', () => {
  it('generates 8-character base62 codes', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateLinkCode()))
    expect(codes.size).toBe(500)
    for (const code of codes) expect(isLinkCode(code)).toBe(true)
  })

  it('rejects anything that is not an 8-character base62 code', () => {
    for (const bad of ['', 'abc', 'abcdefghi', 'abcd-fgh', 'abcd fgh', 'abcdefg/', '../etc/x']) {
      expect(isLinkCode(bad)).toBe(false)
    }
  })
})

describe('createTrackedLinks', () => {
  it('allocates one code per link and finds them again for the same message', async () => {
    const { contact, message, automationId } = await seed()
    const c = await contact(1)
    const m = await message(c.id)
    const input = {
      messageId: m.id,
      contactId: c.id,
      automationId,
      links: [
        { position: 0, url: 'https://a.example/one' },
        { position: 2, url: 'https://a.example/two' },
      ],
    }
    const first = await createTrackedLinks(db, input)
    expect([...first.keys()].sort()).toEqual([0, 2])
    expect(first.get(0)).not.toBe(first.get(2))

    const again = await createTrackedLinks(db, input)
    expect(again).toEqual(first)
    expect(await db.select().from(trackedLinks).where(eq(trackedLinks.messageId, m.id))).toHaveLength(2)
  })

  it('looks a link up by code and records clicks', async () => {
    const { contact, link } = await seed()
    const c = await contact(1)
    const tracked = await link(c.id, 'https://a.example/guide')
    expect(await getTrackedLink(db, tracked.code)).toEqual({ id: tracked.id, url: 'https://a.example/guide' })
    expect(await getTrackedLink(db, 'zzzzzzzz')).toBeNull()

    await recordLinkClick(db, tracked.id)
    expect(await db.select().from(linkClicks).where(eq(linkClicks.linkId, tracked.id))).toHaveLength(1)
  })
})

describe('linkStatsByAutomation', () => {
  it('counts the people sent a link and the people who clicked, once each', async () => {
    const { automationId, contact, link } = await seed()
    const [a, b, c] = [await contact(1), await contact(2), await contact(3)]
    const linkA = await link(a.id, 'https://a.example/guide')
    await link(b.id, 'https://a.example/guide')
    await link(c.id, 'https://a.example/guide', 'failed')
    await recordLinkClick(db, linkA.id)
    await recordLinkClick(db, linkA.id)

    const stats = await linkStatsByAutomation(db, [automationId], lastMonth())
    expect(stats.get(automationId)).toEqual({ recipients: 2, clickers: 1 })
  })

  it('counts a person who got several links once', async () => {
    const { automationId, contact, link } = await seed()
    const a = await contact(1)
    const first = await link(a.id, 'https://a.example/one')
    const second = await link(a.id, 'https://a.example/two')
    await recordLinkClick(db, first.id)
    await recordLinkClick(db, second.id)
    expect((await linkStatsByAutomation(db, [automationId], lastMonth())).get(automationId)).toEqual({ recipients: 1, clickers: 1 })
  })

  it('ignores links sent before the window, even if clicked inside it, so clickers never exceed recipients', async () => {
    const { automationId, contact, link } = await seed()
    const a = await contact(1)
    const old = await link(a.id, 'https://a.example/old')
    await db.update(trackedLinks).set({ createdAt: longAgo }).where(eq(trackedLinks.id, old.id))
    await recordLinkClick(db, old.id)
    expect((await linkStatsByAutomation(db, [automationId], lastMonth())).get(automationId)).toBeUndefined()
  })

  it('returns an empty map for no automations', async () => {
    expect((await linkStatsByAutomation(db, [], lastMonth())).size).toBe(0)
  })
})

describe('automationLinkInsights', () => {
  it('groups by destination and counts recipients, clickers and clicks', async () => {
    const { automationId, contact, link } = await seed()
    const [a, b] = [await contact(1), await contact(2)]
    const a1 = await link(a.id, 'https://a.example/guide')
    await link(b.id, 'https://a.example/guide')
    await link(b.id, 'https://a.example/other')
    await recordLinkClick(db, a1.id)
    await recordLinkClick(db, a1.id)

    expect(await automationLinkInsights(db, automationId, lastMonth())).toEqual([
      { url: 'https://a.example/guide', recipients: 2, clickers: 1, clicks: 2 },
      { url: 'https://a.example/other', recipients: 1, clickers: 0, clicks: 0 },
    ])
  })
})

describe('automationLinkDaily', () => {
  it('returns 14 days, oldest first, with today’s clicks', async () => {
    const { automationId, contact, link } = await seed()
    const a = await contact(1)
    const tracked = await link(a.id, 'https://a.example/guide')
    await recordLinkClick(db, tracked.id)
    await recordLinkClick(db, tracked.id)

    const days = await automationLinkDaily(db, automationId, 'https://a.example/guide')
    expect(days).toHaveLength(14)
    expect(days.map((d) => d.day)).toEqual([...days.map((d) => d.day)].sort())
    expect(days.at(-1)?.clicks).toBe(2)
    expect(days.slice(0, -1).every((d) => d.clicks === 0)).toBe(true)
  })
})

describe('deleted records', () => {
  it('keeps links working after the automation and contact are deleted', async () => {
    const { automationId, contact, link } = await seed()
    const a = await contact(1)
    const tracked = await link(a.id, 'https://a.example/guide')
    await recordLinkClick(db, tracked.id)

    await db.delete(automations).where(eq(automations.id, automationId))
    await db.delete(contacts).where(eq(contacts.id, a.id))

    expect(await getTrackedLink(db, tracked.code)).toEqual({ id: tracked.id, url: 'https://a.example/guide' })
    const [row] = await db.select().from(trackedLinks).where(eq(trackedLinks.id, tracked.id))
    expect(row).toMatchObject({ automationId: null, contactId: null, messageId: null })
    expect(await db.select().from(linkClicks).where(eq(linkClicks.linkId, tracked.id))).toHaveLength(1)
    await recordLinkClick(db, tracked.id)
    expect(await db.select().from(linkClicks).where(eq(linkClicks.linkId, tracked.id))).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @replyooo/db exec vitest run test/link-tracking.test.ts`
Expected: FAIL with a TypeScript/import error such as `createTrackedLinks is not a function` (nothing exists yet).

- [ ] **Step 3: Add the tables to the schema**

Append to the end of `packages/db/src/schema.ts` (after the `bioEvents` table):

```ts
// ---------- link click tracking ----------

/**
 * One row per link button of a sent DM; `/l/<code>` redirects to `url`. Every foreign key is SET NULL so a link
 * already sitting in someone's DM keeps working after the automation, message or contact is deleted.
 */
export const trackedLinks = pgTable(
  'tracked_links',
  {
    id: id(),
    code: text('code').notNull(),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
    /** The button's index in the message, so a retried send finds the same row. */
    position: integer('position').notNull(),
    url: text('url').notNull(),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    automationId: uuid('automation_id').references(() => automations.id, { onDelete: 'set null' }),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tracked_links_code_uq').on(t.code),
    uniqueIndex('tracked_links_message_position_uq').on(t.messageId, t.position),
    index('tracked_links_automation_idx').on(t.automationId, t.createdAt),
  ],
)

export const linkClicks = pgTable(
  'link_clicks',
  {
    id: id(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => trackedLinks.id, { onDelete: 'cascade' }),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [index('link_clicks_link_idx').on(t.linkId, t.createdAt)],
)
```

- [ ] **Step 4: Generate the migration and check it**

Run: `pnpm --filter @replyooo/db exec drizzle-kit generate --name link_click_tracking`
Expected: creates `packages/db/migrations/0008_link_click_tracking.sql` and updates `migrations/meta/_journal.json` and a new snapshot.

Read `packages/db/migrations/0008_link_click_tracking.sql`. It must contain `CREATE TABLE "tracked_links"`, `CREATE TABLE "link_clicks"`, foreign keys on `message_id`, `contact_id` and `automation_id` with `ON DELETE set null`, the one on `link_clicks.link_id` with `ON DELETE cascade`, `CREATE UNIQUE INDEX "tracked_links_code_uq"`, `CREATE UNIQUE INDEX "tracked_links_message_position_uq"`, and the two plain indexes. If any `ON DELETE` is wrong, fix the schema and regenerate (delete the generated `0008_*` files and the snapshot first).

- [ ] **Step 5: Add the link-code helpers**

Create `packages/db/src/link-codes.ts`:

```ts
import { randomBytes } from 'node:crypto'

export const LINK_CODE_LENGTH = 8
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const LINK_CODE_PATTERN = new RegExp(`^[0-9A-Za-z]{${LINK_CODE_LENGTH}}$`)

/** True for exactly the strings `generateLinkCode` can produce. Check this before touching the database. */
export function isLinkCode(value: string): boolean {
  return LINK_CODE_PATTERN.test(value)
}

/** A random 8-character base62 code. Bytes >= 248 are skipped so every character is equally likely. */
export function generateLinkCode(): string {
  let code = ''
  while (code.length < LINK_CODE_LENGTH) {
    for (const byte of randomBytes(16)) {
      if (byte >= 248) continue
      code += ALPHABET[byte % ALPHABET.length]
      if (code.length === LINK_CODE_LENGTH) break
    }
  }
  return code
}
```

Add to `packages/db/src/index.ts` (after the `./crypto` line):

```ts
export * from './link-codes'
```

- [ ] **Step 6: Add the queries**

In `packages/db/src/queries.ts`, change the first import line and the schema import:

```ts
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import type { Db, Tx } from './client'
import { generateLinkCode } from './link-codes'
import {
  authUsers,
  type BioBlockConfig,
  type BioBlockType,
  bioBlocks,
  bioEvents,
  bioPages,
  connectedAccounts,
  linkClicks,
  messages,
  trackedLinks,
  workspaceMembers,
  workspaces,
} from './schema'
```

Append to the end of `packages/db/src/queries.ts`:

```ts
// ---------- link click tracking ----------

export interface LinkToTrack {
  /** The button's index in the message. */
  position: number
  url: string
}

/**
 * Creates the tracked link for each button of a message, or finds it again when the message is retried.
 * Returns the codes by button position. A code that collides with an existing one is simply drawn again.
 */
export async function createTrackedLinks(
  db: Db | Tx,
  input: { messageId: string; contactId: string; automationId: string; links: LinkToTrack[] },
): Promise<Map<number, string>> {
  const codes = new Map<number, string>()
  for (let attempt = 0; attempt < 5; attempt++) {
    const missing = input.links.filter((link) => !codes.has(link.position))
    if (missing.length === 0) return codes
    await db
      .insert(trackedLinks)
      .values(
        missing.map((link) => ({
          code: generateLinkCode(),
          messageId: input.messageId,
          position: link.position,
          url: link.url,
          contactId: input.contactId,
          automationId: input.automationId,
        })),
      )
      .onConflictDoNothing()
    const rows = await db
      .select({ position: trackedLinks.position, code: trackedLinks.code })
      .from(trackedLinks)
      .where(eq(trackedLinks.messageId, input.messageId))
    for (const row of rows) codes.set(row.position, row.code)
  }
  if (input.links.some((link) => !codes.has(link.position))) throw new Error('Could not allocate link codes')
  return codes
}

export async function getTrackedLink(db: Db | Tx, code: string): Promise<{ id: string; url: string } | null> {
  const [row] = await db.select({ id: trackedLinks.id, url: trackedLinks.url }).from(trackedLinks).where(eq(trackedLinks.code, code))
  return row ?? null
}

export async function recordLinkClick(db: Db | Tx, linkId: string): Promise<void> {
  await db.insert(linkClicks).values({ linkId })
}

export interface LinkStats {
  /** People sent at least one tracked link (in a message that was actually sent). */
  recipients: number
  /** Of those, people who opened at least one. */
  clickers: number
}

/** Link numbers per automation for links created since `since`. Automations with no links are absent. */
export async function linkStatsByAutomation(db: Db | Tx, automationIds: string[], since: Date): Promise<Map<string, LinkStats>> {
  const stats = new Map<string, LinkStats>()
  if (automationIds.length === 0) return stats
  const rows = await db
    .select({
      automationId: trackedLinks.automationId,
      recipients: sql<number>`count(distinct ${trackedLinks.contactId})::int`,
      clickers: sql<number>`count(distinct ${trackedLinks.contactId}) filter (where ${linkClicks.id} is not null)::int`,
    })
    .from(trackedLinks)
    .innerJoin(messages, eq(messages.id, trackedLinks.messageId))
    .leftJoin(linkClicks, eq(linkClicks.linkId, trackedLinks.id))
    .where(and(inArray(trackedLinks.automationId, automationIds), eq(messages.status, 'sent'), gte(trackedLinks.createdAt, since)))
    .groupBy(trackedLinks.automationId)
  for (const row of rows) {
    if (row.automationId) stats.set(row.automationId, { recipients: row.recipients, clickers: row.clickers })
  }
  return stats
}

export interface LinkInsight extends LinkStats {
  url: string
  clicks: number
}

/** Per-destination numbers for one automation, most clicked first. */
export async function automationLinkInsights(db: Db | Tx, automationId: string, since: Date): Promise<LinkInsight[]> {
  return db
    .select({
      url: trackedLinks.url,
      recipients: sql<number>`count(distinct ${trackedLinks.contactId})::int`,
      clickers: sql<number>`count(distinct ${trackedLinks.contactId}) filter (where ${linkClicks.id} is not null)::int`,
      clicks: sql<number>`count(${linkClicks.id})::int`,
    })
    .from(trackedLinks)
    .innerJoin(messages, eq(messages.id, trackedLinks.messageId))
    .leftJoin(linkClicks, eq(linkClicks.linkId, trackedLinks.id))
    .where(and(eq(trackedLinks.automationId, automationId), eq(messages.status, 'sent'), gte(trackedLinks.createdAt, since)))
    .groupBy(trackedLinks.url)
    .orderBy(desc(sql`count(${linkClicks.id})`), desc(sql`count(distinct ${trackedLinks.contactId})`), asc(trackedLinks.url))
}

/** Clicks per day on one destination of an automation over the last `days` days, oldest first (UTC days, zeros included). */
export async function automationLinkDaily(
  db: Db | Tx,
  automationId: string,
  url: string,
  days = 14,
): Promise<{ day: string; clicks: number }[]> {
  const rows = await db.execute<{ day: string; clicks: number }>(sql`
    select to_char(d.day, 'YYYY-MM-DD') as day, count(c.id)::int as clicks
    from generate_series(
      (now() at time zone 'utc')::date - (${days}::int - 1),
      (now() at time zone 'utc')::date,
      interval '1 day'
    ) as d(day)
    left join (
      select lc.id, lc.created_at
      from ${linkClicks} lc
      join ${trackedLinks} tl on tl.id = lc.link_id
      where tl.automation_id = ${automationId} and tl.url = ${url}
    ) c on (c.created_at at time zone 'utc')::date = d.day::date
    group by d.day
    order by d.day
  `)
  return Array.from(rows)
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @replyooo/db exec vitest run test/link-tracking.test.ts`
Expected: PASS (all tests in the file).
Then: `pnpm --filter @replyooo/db test && pnpm --filter @replyooo/db typecheck`
Expected: PASS, no type errors.

- [ ] **Step 8: Align the spec's stats definition**

In `docs/superpowers/specs/2026-10-13-link-click-tracking-design.md` §3 "Stats", replace the line beginning `- Clickers: distinct` with:

```
- Clickers: distinct `contact_id` among those recipients' links that have at least one `link_clicks` row (links are counted by creation date, clicks at any time), so clickers never exceed recipients.
```

- [ ] **Step 9: Commit**

```bash
git add packages/db docs/superpowers/specs/2026-10-13-link-click-tracking-design.md
git commit -m "feat(db): tracked links and link clicks tables with stats queries

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Worker rewrites link buttons when sending

**Files:**
- Modify: `apps/worker/src/outbound.ts`
- Test: `apps/worker/test/outbound.test.ts`

**Interfaces:**
- Consumes: `createTrackedLinks` (Task 1); existing `Deps` (`deps.db`, `deps.log`, `deps.appUrl`), `OutboundBody` from `./flow`, `MessageRow`.
- Produces: `withTrackedLinks(deps, message, create = createTrackedLinks): Promise<MessageRow>`: returns the message with each `url` button's `url` replaced by `${appUrl}/l/<code>`, or the unchanged message when nothing is tracked or tracking fails.

- [ ] **Step 1: Update the existing test and write the new failing tests**

In `apps/worker/test/outbound.test.ts`:

(a) Add `trackedLinks` to the `@replyooo/db` import and `withTrackedLinks` to the outbound import:

```ts
import { connectedAccounts, contacts, flowRuns, messages, trackedLinks, usageCounters } from '@replyooo/db'
```
```ts
import { handleOutbound, withTrackedLinks } from '../src/outbound'
```

(b) In the test `'sends in order, encodes button payloads and marks messages sent'`, the url button is now rewritten. Replace the expected call for the second message:

```ts
          buttons: [
            { type: 'postback', label: 'Send it', payload: `r:${run.id}:s1:b1` },
            { type: 'url', label: 'Shop', url: expect.stringMatching(/^http:\/\/localhost:3000\/l\/[0-9A-Za-z]{8}$/) },
          ],
```

(c) Append a new `describe` block at the end of the file:

```ts
describe('link tracking', () => {
  const shop = (url = 'https://shop.example/a'): OutboundBody => ({
    type: 'message',
    message: {
      text: 'Want it?',
      buttons: [
        { type: 'url', label: 'Shop', url },
        { type: 'reply', label: 'Send it', stepId: 's1', buttonId: 'b1' },
        { type: 'url', label: 'Docs', url: 'https://docs.example/b' },
      ],
    },
  })

  const sentButtons = (adapters: Awaited<ReturnType<typeof setup>>['adapters']) =>
    (adapters.instagram.sent('sendMessage')[0]?.args[1] as { buttons: { type: string; label: string; url?: string }[] }).buttons

  it('sends a tracked link for each url button and keeps the real destination in the database', async () => {
    const { db, deps, adapters, contact, run, queue } = await setup()
    const [id] = await queue({ kind: 'dm', body: shop() })
    await handleOutbound(deps, { messageIds: [id!] })

    const rows = await db.select().from(trackedLinks).where(eq(trackedLinks.messageId, id!))
    expect(rows.map((r) => [r.position, r.url]).sort()).toEqual([
      [0, 'https://shop.example/a'],
      [2, 'https://docs.example/b'],
    ])
    expect(rows.every((r) => r.contactId === contact.id)).toBe(true)
    const [runRow] = await db.select().from(flowRuns).where(eq(flowRuns.id, run.id))
    expect(rows.every((r) => r.automationId === runRow!.automationId)).toBe(true)

    const byPosition = Object.fromEntries(rows.map((r) => [r.position, r.code]))
    const buttons = sentButtons(adapters)
    expect(buttons[0]).toEqual({ type: 'url', label: 'Shop', url: `http://localhost:3000/l/${byPosition[0]}` })
    expect(buttons[1]?.type).toBe('postback')
    expect(buttons[2]).toEqual({ type: 'url', label: 'Docs', url: `http://localhost:3000/l/${byPosition[2]}` })
  })

  it('uses the app URL without a trailing slash', async () => {
    const { deps, adapters, queue } = await setup()
    const [id] = await queue({ kind: 'dm', body: shop() })
    await handleOutbound({ ...deps, appUrl: 'https://app.example.com/' }, { messageIds: [id!] })
    expect(sentButtons(adapters)[0]?.url).toMatch(/^https:\/\/app\.example\.com\/l\/[0-9A-Za-z]{8}$/)
  })

  it('reuses the same codes when a message is retried', async () => {
    const { db, deps, adapters, queue } = await setup()
    const [id] = await queue({ kind: 'dm', body: shop() })
    const [row] = await db.select().from(messages).where(eq(messages.id, id!))

    const first = await withTrackedLinks(deps, row!)
    const second = await withTrackedLinks(deps, row!)
    expect(second.body).toEqual(first.body)
    expect(await db.select().from(trackedLinks).where(eq(trackedLinks.messageId, id!))).toHaveLength(2)
    expect(adapters.instagram.sent()).toEqual([])
  })

  it('tracks private replies too', async () => {
    const { db, deps, queue } = await setup()
    const [id] = await queue({ kind: 'private_reply', commentId: 'c1', body: shop() })
    await handleOutbound(deps, { messageIds: [id!] })
    expect(await db.select().from(trackedLinks).where(eq(trackedLinks.messageId, id!))).toHaveLength(2)
  })

  it('leaves messages without url buttons, images and comment replies alone', async () => {
    const { db, deps, adapters, queue } = await setup()
    const ids = await queue(
      { kind: 'dm', body: { type: 'image', url: 'https://img.example/a.png' } },
      { kind: 'dm', body: text('plain') },
      { kind: 'dm', body: { type: 'message', message: { text: 'Pick', buttons: [{ type: 'reply', label: 'Yes', stepId: 's1', buttonId: 'b1' }] } } },
      { kind: 'comment_reply', commentId: 'c9', body: { type: 'comment', text: 'Check your DMs https://x.example/y' } },
    )
    await handleOutbound(deps, { messageIds: ids })
    expect(await db.select().from(trackedLinks).where(inArray(trackedLinks.messageId, ids))).toEqual([])
    expect(adapters.instagram.sent('sendMessage')).toHaveLength(3)
  })

  it('falls back to the original links when tracking fails', async () => {
    const { db, deps, queue } = await setup()
    const [id] = await queue({ kind: 'dm', body: shop() })
    const [row] = await db.select().from(messages).where(eq(messages.id, id!))
    const failing = async () => {
      throw new Error('database unavailable')
    }
    const result = await withTrackedLinks(deps, row!, failing)
    expect(result).toBe(row)
  })

  it('sends the original links when the message has no flow run to attribute them to', async () => {
    const { db, deps, adapters, queue } = await setup()
    const [id] = await queue({ kind: 'dm', body: shop() })
    await db.update(messages).set({ flowRunId: null }).where(eq(messages.id, id!))
    await handleOutbound(deps, { messageIds: [id!] })
    expect(sentButtons(adapters)[0]?.url).toBe('https://shop.example/a')
    expect(await db.select().from(trackedLinks).where(eq(trackedLinks.messageId, id!))).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @replyooo/worker exec vitest run test/outbound.test.ts`
Expected: FAIL: `withTrackedLinks` is not exported; the updated first test fails because the URL is not rewritten yet.

- [ ] **Step 3: Implement `withTrackedLinks` and use it**

In `apps/worker/src/outbound.ts`:

(a) Change the db import to add `createTrackedLinks` and `flowRuns`:

```ts
import { connectedAccounts, contacts, createTrackedLinks, flowRuns, messages, usageCounters } from '@replyooo/db'
```

(b) In `handleOutbound`, replace the `send(...)` call:

```ts
      const result = await send(deps.adapters[account.platform], credentials(account, deps.tokenKey), contact, await withTrackedLinks(deps, message))
```

(c) Add this function after `withinWindow`:

```ts
/**
 * Swaps each url button of a DM for a short tracked link (`${APP_URL}/l/<code>`). A retried message finds its
 * existing links, so codes stay stable. Tracking must never stop a DM: on any error the original message is sent.
 */
export async function withTrackedLinks(
  deps: Deps,
  message: MessageRow,
  create: typeof createTrackedLinks = createTrackedLinks,
): Promise<MessageRow> {
  if ((message.kind !== 'dm' && message.kind !== 'private_reply') || !message.flowRunId) return message
  const body = message.body as unknown as OutboundBody
  if (body.type !== 'message') return message
  const buttons = body.message.buttons ?? []
  const links = buttons.flatMap((button, position) => (button.type === 'url' ? [{ position, url: button.url }] : []))
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
    const trackedBody: OutboundBody = { type: 'message', message: { ...body.message, buttons: tracked } }
    return { ...message, body: trackedBody as unknown as Record<string, unknown> }
  } catch (error) {
    deps.log.warn({ messageId: message.id, err: error }, 'link tracking failed; sending the original links')
    return message
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @replyooo/worker exec vitest run test/outbound.test.ts`
Expected: PASS.
Then: `pnpm --filter @replyooo/worker test && pnpm --filter @replyooo/worker typecheck`
Expected: PASS. If another worker test asserted a raw `https://` button URL, update it the same way as step 1(b) (the URL is now `http://localhost:3000/l/<8 chars>`).

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): send tracked short links for DM link buttons

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Public redirect route, bot filter move and robots

**Files:**
- Create: `apps/web/src/lib/bots.ts`
- Modify: `apps/web/src/lib/bio.ts` (remove `isBotUserAgent`)
- Modify: `apps/web/src/app/u/[slug]/out/[blockId]/route.ts` (import path)
- Modify: `apps/web/test/bio.test.ts` (import path)
- Create: `apps/web/src/app/l/[code]/route.ts`
- Modify: `apps/web/src/app/robots.ts`
- Test: `apps/web/test/link-redirect.test.ts`

**Interfaces:**
- Consumes: `getTrackedLink`, `isLinkCode`, `recordLinkClick`, `generateLinkCode`, `trackedLinks`, `linkClicks` from `@replyooo/db` (Task 1); `isSafeHttpUrl` from `@/lib/bio`; `db()` from `@/lib/db`.
- Produces: `isBotUserAgent(userAgent)` in `@/lib/bots` (same behavior as before); `GET` and `HEAD` handlers at `/l/[code]`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/link-redirect.test.ts`:

```ts
import { generateLinkCode, linkClicks, trackedLinks } from '@replyooo/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { GET, HEAD } from '@/app/l/[code]/route'
import { db } from '@/lib/db'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

async function link(url: string) {
  const code = generateLinkCode()
  const [row] = await db().insert(trackedLinks).values({ code, position: 0, url }).returning()
  return { code, id: row!.id }
}

const request = (code: string, headers: Record<string, string> = {}, method = 'GET') =>
  new Request(`http://localhost/l/${code}`, { method, headers })
const params = (code: string) => ({ params: Promise.resolve({ code }) })
const clicks = async (linkId: string) => (await db().select().from(linkClicks).where(eq(linkClicks.linkId, linkId))).length

describe('GET /l/[code]', () => {
  it('redirects a visitor to the destination and counts the click', async () => {
    const { code, id } = await link('https://example.com/guide')
    const response = await GET(request(code, { 'user-agent': IPHONE }), params(code))
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://example.com/guide')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await clicks(id)).toBe(1)
  })

  it('counts every visit, so repeat taps are visible as clicks', async () => {
    const { code, id } = await link('https://example.com/guide')
    await GET(request(code, { 'user-agent': IPHONE }), params(code))
    await GET(request(code, { 'user-agent': IPHONE }), params(code))
    expect(await clicks(id)).toBe(2)
  })

  it.each([
    ['a link preview bot', { 'user-agent': 'facebookexternalhit/1.1' }],
    ['a crawler', { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }],
    ['a request with no user agent', {}],
  ])('redirects %s without counting a click', async (_name, headers) => {
    const { code, id } = await link('https://example.com/guide')
    const response = await GET(request(code, headers), params(code))
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://example.com/guide')
    expect(await clicks(id)).toBe(0)
  })

  it('answers HEAD requests without counting a click', async () => {
    const { code, id } = await link('https://example.com/guide')
    const response = await HEAD(request(code, { 'user-agent': IPHONE }, 'HEAD'), params(code))
    expect(response.status).toBe(302)
    expect(await clicks(id)).toBe(0)
  })

  it.each(['', 'abc', 'abcdefghi', 'abcd-fgh', '../../x'])('returns 404 for the malformed code %j', async (code) => {
    const response = await GET(request(code || 'x', { 'user-agent': IPHONE }), params(code))
    expect(response.status).toBe(404)
  })

  it('returns 404 for a well-formed code that does not exist', async () => {
    const response = await GET(request('Zz9Zz9Zz', { 'user-agent': IPHONE }), params('Zz9Zz9Zz'))
    expect(response.status).toBe(404)
  })

  it.each(['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com/a', 'not a url'])(
    'refuses to redirect to the stored destination %j',
    async (url) => {
      const { code, id } = await link(url)
      const response = await GET(request(code, { 'user-agent': IPHONE }), params(code))
      expect(response.status).toBe(404)
      expect(response.headers.get('location')).toBeNull()
      expect(await clicks(id)).toBe(0)
    },
  )
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @replyooo/web exec vitest run test/link-redirect.test.ts`
Expected: FAIL: cannot resolve `@/app/l/[code]/route`.

- [ ] **Step 3: Move the bot filter**

Create `apps/web/src/lib/bots.ts`:

```ts
/** User agents that are not a person opening a link: crawlers, link-preview fetchers and scripts. A missing user agent counts as one. */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true
  return /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|curl|wget|headless|monitor/i.test(userAgent)
}
```

In `apps/web/src/lib/bio.ts` delete the whole `isBotUserAgent` function (the `export function isBotUserAgent(...) { ... }` block, lines 119-122) and its doc comment if it has one.

In `apps/web/src/app/u/[slug]/out/[blockId]/route.ts` change the import:

```ts
import { isSafeHttpUrl } from '@/lib/bio'
import { isBotUserAgent } from '@/lib/bots'
```

In `apps/web/test/bio.test.ts` change the first import to drop `isBotUserAgent` and add:

```ts
import { isBotUserAgent } from '@/lib/bots'
```

- [ ] **Step 4: Write the redirect route**

Create `apps/web/src/app/l/[code]/route.ts`:

```ts
import { getTrackedLink, isLinkCode, recordLinkClick } from '@replyooo/db'
import { isSafeHttpUrl } from '@/lib/bio'
import { isBotUserAgent } from '@/lib/bots'
import { db } from '@/lib/db'

const notFound = () => new Response('Not found', { status: 404 })

async function open(request: Request, code: string, count: boolean): Promise<Response> {
  // Checked before any query: random paths must not cost a database round trip.
  if (!isLinkCode(code)) return notFound()
  const link = await getTrackedLink(db(), code)
  if (!link || !isSafeHttpUrl(link.url)) return notFound()
  if (count && !isBotUserAgent(request.headers.get('user-agent'))) {
    // A failed count must never stop the person reaching the link.
    await recordLinkClick(db(), link.id).catch(() => {})
  }
  return new Response(null, { status: 302, headers: { Location: link.url, 'Cache-Control': 'no-store' } })
}

/** Short link from a DM button: counts the tap, then sends the person to the real destination. */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  return open(request, (await params).code, true)
}

/** Previewers often probe with HEAD first; those must not count as clicks. */
export async function HEAD(request: Request, { params }: { params: Promise<{ code: string }> }) {
  return open(request, (await params).code, false)
}
```

- [ ] **Step 5: Keep crawlers off `/l/`**

In `apps/web/src/app/robots.ts` add `'/l/'` to the `disallow` array (after `'/api/'`):

```ts
        '/api/',
        '/l/',
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @replyooo/web exec vitest run test/link-redirect.test.ts test/bio.test.ts`
Expected: PASS.
Then: `pnpm --filter @replyooo/web typecheck`
Expected: PASS (no remaining import of `isBotUserAgent` from `@/lib/bio`; if the typecheck reports one, change that import to `@/lib/bots`).

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): /l/<code> redirect that counts link clicks

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Click numbers in the automations list and the editor stats bar

**Files:**
- Modify: `apps/web/src/lib/data/types.ts`
- Modify: `apps/web/src/lib/data/automations.ts`
- Modify: `apps/web/src/app/(app)/automations/automations-table.tsx`
- Modify: `apps/web/src/app/(app)/automations/[id]/editor.tsx`
- Test: `apps/web/test/automations.test.ts`

**Interfaces:**
- Consumes: `linkStatsByAutomation` (Task 1); `clickRate(clicks, views)` from `@/lib/bio` (returns a whole percent, `0` when `views <= 0`).
- Produces: `AutomationStats` now has `recipients: number` and `clickers: number`; every `Automation` returned by `listAutomations` / `getAutomation` carries them.

- [ ] **Step 1: Update and add the failing tests**

In `apps/web/test/automations.test.ts`:

(a) Add to the imports: `linkClicks, trackedLinks` from `@replyooo/db`, and `randomUUID` from `node:crypto`:

```ts
import { automationVersions, automations, linkClicks, trackedLinks } from '@replyooo/db'
import { randomUUID } from 'node:crypto'
```

(b) In `'counts runs, completions, DMs sent and leads from the last 30 days'`, change the final expectation:

```ts
    expect(listed?.stats).toEqual({ runs: 2, completed: 1, dmsSent: 2, leads: 1, recipients: 0, clickers: 0 })
```

(c) Add this test right after it, inside `describe('listAutomations', ...)`:

```ts
  it('counts the people sent a link and the people who opened it from the last 30 days', async () => {
    const { workspaceId, accountId } = await setup()
    const automation = await created(workspaceId, accountId, 'comment_to_dm')
    await data.publishAutomation(workspaceId, automation.id)
    const [a, b, c] = [
      await createContact(workspaceId, accountId),
      await createContact(workspaceId, accountId),
      await createContact(workspaceId, accountId),
    ]
    const tracked = async (contactId: string, status: 'sent' | 'failed' = 'sent') => {
      const run = await createRun({ automationId: automation.id, contactId, accountId, status: 'completed' })
      const message = await createMessage({ contactId, accountId, runId: run.id, kind: 'dm', status })
      const [link] = await db()
        .insert(trackedLinks)
        .values({ code: randomUUID().replace(/-/g, '').slice(0, 8), messageId: message.id, position: 0, url: 'https://example.com', contactId, automationId: automation.id })
        .returning()
      return link!
    }
    const linkA = await tracked(a.id)
    await tracked(b.id)
    await tracked(c.id, 'failed')
    await db().insert(linkClicks).values([{ linkId: linkA.id }, { linkId: linkA.id }])

    const [listed] = await data.listAutomations(workspaceId, accountId)
    expect(listed?.stats).toMatchObject({ recipients: 2, clickers: 1 })
    expect((await data.getAutomation(workspaceId, automation.id))?.stats).toMatchObject({ recipients: 2, clickers: 1 })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @replyooo/web exec vitest run test/automations.test.ts`
Expected: FAIL: the first expectation lacks `recipients`/`clickers`, and the new test gets `undefined`.

- [ ] **Step 3: Extend the stats type and query**

In `apps/web/src/lib/data/types.ts`:

```ts
export interface AutomationStats {
  runs: number
  completed: number
  dmsSent: number
  leads: number
  /** People sent a tracked link in the last 30 days, and how many of them opened one. */
  recipients: number
  clickers: number
}
```

In `apps/web/src/lib/data/automations.ts`:

(a) Add `linkStatsByAutomation` to the `@replyooo/db` import:

```ts
import { type Tx, automationVersions, automations, connectedAccounts, contacts, flowRuns, linkStatsByAutomation, messages } from '@replyooo/db'
```

(b) Update the empty value:

```ts
const EMPTY_STATS: AutomationStats = { runs: 0, completed: 0, dmsSent: 0, leads: 0, recipients: 0, clickers: 0 }
```

(c) In `automationStats`, change the runs loop and add the link merge after the sent loop:

```ts
  for (const row of runRows) {
    stats.set(row.automationId, { runs: row.runs, completed: row.completed, leads: row.leads, dmsSent: 0, recipients: 0, clickers: 0 })
  }
  for (const row of sentRows) {
    stats.set(row.automationId, { ...(stats.get(row.automationId) ?? EMPTY_STATS), dmsSent: row.dmsSent })
  }
  for (const [automationId, link] of await linkStatsByAutomation(db(), ids, since)) {
    stats.set(automationId, { ...(stats.get(automationId) ?? EMPTY_STATS), ...link })
  }
  return stats
```

(replace the existing two loops and the existing `return stats`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @replyooo/web exec vitest run test/automations.test.ts`
Expected: PASS.

- [ ] **Step 5: Show the numbers in the list and the editor**

In `apps/web/src/app/(app)/automations/automations-table.tsx`:

(a) Import the helper next to the other lib imports:

```ts
import { clickRate } from '@/lib/bio'
```

(b) Header: add a column between "DMs sent" and "Completion":

```tsx
              <th className="hidden text-right md:table-cell">DMs sent</th>
              <th className="hidden text-right md:table-cell">Click rate</th>
              <th className="hidden pr-2 text-right md:table-cell">Completion</th>
```

(c) Row: add the matching cell after the "DMs sent" cell:

```tsx
      <td className="hidden text-right text-[14.5px] tabular-nums md:table-cell" title={live && stats.recipients > 0 ? `${stats.clickers} of ${stats.recipients} people opened a link` : undefined}>
        {live && stats.recipients > 0 ? `${clickRate(stats.clickers, stats.recipients)}%` : '—'}
      </td>
```

(d) Mobile summary line: replace

```tsx
                {formatNumber(stats.runs)} runs · {formatNumber(stats.dmsSent)} DMs
```
with
```tsx
                {formatNumber(stats.runs)} runs · {formatNumber(stats.dmsSent)} DMs
                {stats.recipients > 0 && ` · ${clickRate(stats.clickers, stats.recipients)}% clicked`}
```

In `apps/web/src/app/(app)/automations/[id]/editor.tsx`:

(a) Add the import next to the other `@/lib` imports:

```ts
import { clickRate } from '@/lib/bio'
```

(b) In the live "Last 30 days" bar, add two metrics after the `leads` one:

```tsx
                  <Metric value={formatNumber(stats.leads)} label="leads" />
                  <Metric value={formatNumber(stats.clickers)} label="link clickers" />
                  <Metric value={stats.recipients > 0 ? `${clickRate(stats.clickers, stats.recipients)}%` : '—'} label="click rate" />
```

- [ ] **Step 6: Typecheck and run the web tests**

Run: `pnpm --filter @replyooo/web typecheck && pnpm --filter @replyooo/web test`
Expected: PASS. If a test or page builds an `AutomationStats` literal without the new fields, add `recipients: 0, clickers: 0` there.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): click rate in the automations list and editor stats

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: "Link clicks" section in the editor

**Files:**
- Modify: `apps/web/src/lib/data/automations.ts` (add `linkInsights`, `linkDaily`)
- Modify: `apps/web/src/app/actions.ts` (add `getLinkInsights`, `getLinkDaily`)
- Create: `apps/web/src/app/(app)/automations/[id]/link-insights.tsx`
- Modify: `apps/web/src/app/(app)/automations/[id]/editor.tsx` (render it)
- Test: `apps/web/test/link-insights.test.ts`

**Interfaces:**
- Consumes: `automationLinkInsights`, `automationLinkDaily`, `LinkInsight` from `@replyooo/db` (Task 1); `statsSince`, `isUuid`; `requireWorkspace()`; `clickRate`.
- Produces:
  - `data.linkInsights(workspaceId, automationId, now = new Date()): Promise<LinkInsight[] | null>`: `null` when the automation is not in the workspace.
  - `data.linkDaily(workspaceId, automationId, url): Promise<{ day: string; clicks: number }[] | null>`.
  - Server actions `getLinkInsights(automationId)` → `{ ok: true; links: LinkInsight[] } | { ok: false; error: string }` and `getLinkDaily(automationId, url)` → `{ ok: true; days: { day: string; clicks: number }[] } | { ok: false; error: string }`.
  - `<LinkInsights automationId={string} />` client component.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/link-insights.test.ts`:

```ts
import { linkClicks, trackedLinks } from '@replyooo/db'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import * as data from '@/lib/data/automations'
import { db } from '@/lib/db'
import { createAccount, createContact, createMessage, createRun, createWorkspace } from './support'

async function setup() {
  const { workspaceId } = await createWorkspace()
  const account = await createAccount(workspaceId)
  const automation = await data.createAutomation(workspaceId, account.id, 'comment_to_dm')
  if (!automation) throw new Error('createAutomation returned null')
  await data.publishAutomation(workspaceId, automation.id)
  return { workspaceId, accountId: account.id, automationId: automation.id }
}

async function sendLink(ctx: Awaited<ReturnType<typeof setup>>, url: string, clicks: number) {
  const contact = await createContact(ctx.workspaceId, ctx.accountId)
  const run = await createRun({ automationId: ctx.automationId, contactId: contact.id, accountId: ctx.accountId })
  const message = await createMessage({ contactId: contact.id, accountId: ctx.accountId, runId: run.id, kind: 'dm' })
  const [link] = await db()
    .insert(trackedLinks)
    .values({ code: randomUUID().replace(/-/g, '').slice(0, 8), messageId: message.id, position: 0, url, contactId: contact.id, automationId: ctx.automationId })
    .returning()
  for (let i = 0; i < clicks; i++) await db().insert(linkClicks).values({ linkId: link!.id })
}

describe('linkInsights', () => {
  it('lists each destination with recipients, clickers and clicks', async () => {
    const ctx = await setup()
    await sendLink(ctx, 'https://example.com/guide', 2)
    await sendLink(ctx, 'https://example.com/guide', 0)
    await sendLink(ctx, 'https://example.com/other', 0)
    expect(await data.linkInsights(ctx.workspaceId, ctx.automationId)).toEqual([
      { url: 'https://example.com/guide', recipients: 2, clickers: 1, clicks: 2 },
      { url: 'https://example.com/other', recipients: 1, clickers: 0, clicks: 0 },
    ])
  })

  it('returns an empty list when no link was sent', async () => {
    const ctx = await setup()
    expect(await data.linkInsights(ctx.workspaceId, ctx.automationId)).toEqual([])
  })

  it('returns null for an automation in another workspace, a malformed id or an unknown id', async () => {
    const ctx = await setup()
    const other = await createWorkspace('Other')
    expect(await data.linkInsights(other.workspaceId, ctx.automationId)).toBeNull()
    expect(await data.linkInsights(ctx.workspaceId, 'not-a-uuid')).toBeNull()
    expect(await data.linkInsights(ctx.workspaceId, randomUUID())).toBeNull()
  })
})

describe('linkDaily', () => {
  it('returns 14 days of clicks for one destination', async () => {
    const ctx = await setup()
    await sendLink(ctx, 'https://example.com/guide', 3)
    const days = await data.linkDaily(ctx.workspaceId, ctx.automationId, 'https://example.com/guide')
    expect(days).toHaveLength(14)
    expect(days?.at(-1)?.clicks).toBe(3)
  })

  it('returns null for an automation in another workspace', async () => {
    const ctx = await setup()
    const other = await createWorkspace('Other')
    expect(await data.linkDaily(other.workspaceId, ctx.automationId, 'https://example.com/guide')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @replyooo/web exec vitest run test/link-insights.test.ts`
Expected: FAIL: `data.linkInsights is not a function`.

- [ ] **Step 3: Add the data functions**

In `apps/web/src/lib/data/automations.ts`, add `automationLinkDaily, automationLinkInsights, type LinkInsight` to the `@replyooo/db` import, then add after `getAutomation`:

```ts
async function ownsAutomation(workspaceId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false
  const [row] = await db()
    .select({ id: automations.id })
    .from(automations)
    .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, id)))
  return Boolean(row)
}

/** Per-destination link numbers for the last 30 days; null when the automation isn't in this workspace. */
export async function linkInsights(workspaceId: string, id: string, now = new Date()): Promise<LinkInsight[] | null> {
  if (!(await ownsAutomation(workspaceId, id))) return null
  return automationLinkInsights(db(), id, statsSince(now))
}

/** Clicks per day on one destination over the last 14 days; null when the automation isn't in this workspace. */
export async function linkDaily(workspaceId: string, id: string, url: string): Promise<{ day: string; clicks: number }[] | null> {
  if (!(await ownsAutomation(workspaceId, id))) return null
  return automationLinkDaily(db(), id, url, 14)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @replyooo/web exec vitest run test/link-insights.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the server actions**

In `apps/web/src/app/actions.ts`, add after `switchWorkspace`:

```ts
export async function getLinkInsights(automationId: string) {
  const { workspaceId } = await requireWorkspace()
  const links = await data.linkInsights(workspaceId, automationId)
  return links ? ({ ok: true, links } as const) : ({ ok: false, error: 'Automation not found' } as const)
}

export async function getLinkDaily(automationId: string, url: string) {
  const { workspaceId } = await requireWorkspace()
  const days = await data.linkDaily(workspaceId, automationId, url)
  return days ? ({ ok: true, days } as const) : ({ ok: false, error: 'Automation not found' } as const)
}
```

- [ ] **Step 6: Write the component**

Create `apps/web/src/app/(app)/automations/[id]/link-insights.tsx`:

```tsx
'use client'

import type { LinkInsight } from '@replyooo/db'
import { useEffect, useState } from 'react'
import { getLinkDaily, getLinkInsights } from '@/app/actions'
import { formatNumber } from '@/components/ui'
import { clickRate } from '@/lib/bio'

type Day = { day: string; clicks: number }

/** The last 14 days of clicks on one destination, loaded when its row is opened. */
function Trend({ automationId, url }: { automationId: string; url: string }) {
  const [days, setDays] = useState<Day[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    getLinkDaily(automationId, url).then((result) => {
      if (cancelled) return
      if (result.ok) setDays(result.days)
      else setFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [automationId, url])

  const max = Math.max(1, ...(days ?? []).map((d) => d.clicks))
  if (failed) return <p className="mt-2 text-[12.5px] text-brand">Couldn’t load the chart.</p>
  return (
    <div className="mt-2 flex h-16 items-end gap-1" role="img" aria-label="Clicks per day, last 14 days">
      {(days ?? Array.from({ length: 14 }, () => ({ day: '', clicks: 0 }))).map((d, i) => (
        <div key={d.day || i} title={d.day ? `${d.day}: ${d.clicks}` : undefined} className="flex h-full flex-1 items-end">
          <div className="w-full rounded-sm bg-ink" style={{ height: d.clicks ? `${Math.max(8, (d.clicks / max) * 100)}%` : '3px', opacity: d.clicks ? 1 : 0.15 }} />
        </div>
      ))}
    </div>
  )
}

/** Clicks on the links this automation sent, per destination, for the last 30 days. Renders nothing until a link has been sent. */
export function LinkInsights({ automationId }: { automationId: string }) {
  const [links, setLinks] = useState<LinkInsight[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    getLinkInsights(automationId).then((result) => {
      if (!cancelled && result.ok) setLinks(result.links)
    })
    return () => {
      cancelled = true
    }
  }, [automationId])

  if (!links || links.length === 0) return null
  return (
    <section className="mt-6 rounded-[18px] border border-line bg-white p-5" aria-labelledby="link-clicks-title">
      <h2 id="link-clicks-title" className="text-[15px] font-semibold">
        Link clicks <span className="font-normal text-subtle">· last 30 days</span>
      </h2>
      <p className="mt-1 text-[12.5px] text-subtle">
        People see a short replyooo link that opens your page. Only DMs sent since link tracking began are counted.
      </p>
      <ul className="mt-3 divide-y divide-line">
        {links.map((link) => (
          <li key={link.url} className="py-3">
            <button
              type="button"
              className="flex w-full items-center gap-3 text-left"
              aria-expanded={open === link.url}
              onClick={() => setOpen(open === link.url ? null : link.url)}
            >
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium" title={link.url}>
                {link.url}
              </span>
              <span className="shrink-0 text-[13px] tabular-nums text-subtle">
                {formatNumber(link.clickers)} of {formatNumber(link.recipients)} · {link.recipients > 0 ? `${clickRate(link.clickers, link.recipients)}%` : '—'}
              </span>
            </button>
            {open === link.url && (
              <div className="mt-2 rounded-xl bg-sand/70 p-3.5">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Tile value={formatNumber(link.recipients)} label="People sent" />
                  <Tile value={formatNumber(link.clickers)} label="People clicked" />
                  <Tile value={formatNumber(link.clicks)} label="Total clicks" />
                </div>
                <p className="mt-3 text-[12.5px] font-medium text-muted">Last 14 days</p>
                <Trend automationId={automationId} url={link.url} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white px-3 py-2.5">
      <div className="text-[20px] font-semibold leading-none tracking-tight">{value}</div>
      <div className="mt-1 text-[12px] text-subtle">{label}</div>
    </div>
  )
}
```

- [ ] **Step 7: Render it in the editor**

In `apps/web/src/app/(app)/automations/[id]/editor.tsx`:

(a) Import (next to `import { Segmented } from './fields'`):

```ts
import { LinkInsights } from './link-insights'
```

(b) Replace

```tsx
          </Accordion>
        </div>

        <aside
```
with
```tsx
          </Accordion>
          {status !== 'draft' && stats.recipients > 0 && <LinkInsights automationId={automation.id} />}
        </div>

        <aside
```

(If the exact text differs, find the `</Accordion>` that closes the section list and add the line directly after it, inside the same left-column `div`.)

- [ ] **Step 8: Typecheck, test and look at it in a browser**

Run: `pnpm --filter @replyooo/web typecheck && pnpm --filter @replyooo/web test`
Expected: PASS.
The visual check happens in Task 6 with real data.

- [ ] **Step 9: Commit**

```bash
git add apps/web
git commit -m "feat(web): link clicks section in the automation editor

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: End-to-end check on the local database and wrap-up

**Files:**
- Modify: `docs/deploy.md` (only if the worker `APP_URL` note is missing, see Step 5)

**Interfaces:**
- Consumes: everything above.
- Produces: a verified feature, ready for the branch to be finished.

- [ ] **Step 1: Run every package's tests, typechecks and the web build**

Run:
```bash
pnpm --filter @replyooo/db test && pnpm --filter @replyooo/worker test && pnpm --filter @replyooo/web test
pnpm typecheck
pnpm --filter @replyooo/web build
```
Expected: all PASS. (Docker must be running for Testcontainers.)

- [ ] **Step 2: Apply the migration to the local dev database**

The local dev Postgres is the `replyooo-3b-postgres-1` container (port 56789). Start it if it is stopped (`docker start replyooo-3b-postgres-1`), then:

```bash
cd packages/db && set -a && source ../../apps/web/.env.local && set +a && pnpm exec drizzle-kit migrate
```
Expected: the `0008_link_click_tracking` migration applies; `docker exec replyooo-3b-postgres-1 psql -U replyooo -d replyooo -c '\d tracked_links'` shows the table.

- [ ] **Step 3: Create one real tracked link for the demo automation**

```bash
docker exec replyooo-3b-postgres-1 psql -U replyooo -d replyooo -c "
insert into tracked_links (code, message_id, position, url, contact_id, automation_id)
select 'Demo1234', m.id, 0, 'https://example.com/guide', m.contact_id, r.automation_id
from messages m
join flow_runs r on r.id = m.flow_run_id
join automations a on a.id = r.automation_id
where a.name = 'Grow your email list' and m.status = 'sent' and m.direction = 'out'
limit 1;"
```
Expected: `INSERT 0 1`. (If it inserts 0 rows, pick another active automation that has a sent outbound message.)

- [ ] **Step 4: Exercise the redirect and see the numbers**

Start the app: `cd apps/web && pnpm exec next dev --port 3217` (background it). Then:

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -A "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1" http://localhost:3217/l/Demo1234
curl -s -o /dev/null -w "%{http_code}\n" -A "facebookexternalhit/1.1" http://localhost:3217/l/Demo1234
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3217/l/nope
docker exec replyooo-3b-postgres-1 psql -U replyooo -d replyooo -c "select count(*) from link_clicks lc join tracked_links tl on tl.id = lc.link_id where tl.code = 'Demo1234'"
```
Expected: `302 https://example.com/guide`, then `302`, then `404`, and a click count of `1` (the browser request counted, the bot did not).

Then log in as `demo@replyooo.dev` / `replyooo-demo` and open the "Grow your email list" automation in the browser preview. Expected: the stats bar shows "link clickers" and "click rate" (`100%`), the "Link clicks" section lists `https://example.com/guide` with "1 of 1 · 100%", and opening the row shows the three tiles and a 14-day chart with today's bar filled. The automations list shows a "Click rate" column with `100%` for that automation. Look at the screenshot, not just the DOM text.

- [ ] **Step 5: Confirm production links will point at the web app**

Run: `grep -n "APP_URL" docs/deploy.md docker-compose.prod.yml deploy/.env.example`
Confirm the worker's `APP_URL` is the public **web** origin (`https://${DOMAIN}` in `docker-compose.prod.yml`), not the separate webhook host mentioned in the Dokploy steps. If `docs/deploy.md` does not say that the worker's `APP_URL` is also where `/l/<code>` links are served, add one sentence next to the worker env vars:

> The worker builds `/l/<code>` link-tracking URLs from `APP_URL`, so it must be the public address of the web app, not the webhooks host.

- [ ] **Step 6: Clean up the demo data and stop the dev server**

```bash
docker exec replyooo-3b-postgres-1 psql -U replyooo -d replyooo -c "delete from tracked_links where code = 'Demo1234'"
pkill -f "next dev --port 3217"
```

- [ ] **Step 7: Record the live test and commit**

Add to the pending real-world tests (memory file `pending-real-world-tests.md`): "Link click tracking: send a real DM with a link button from a connected account, tap it on a phone, confirm the click lands once, and check Instagram's in-app browser or link scanner does not pre-fetch the link and inflate counts."

```bash
git add -A docs apps packages
git status --short
git commit -m "docs: note where link-tracking URLs are served from

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
(Skip this commit if Step 5 changed nothing.)

Then use superpowers:finishing-a-development-branch to decide how to integrate `feat/link-click-tracking`.
