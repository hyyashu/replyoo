# Replyooo Plan 3b: Postgres, Auth & Meta Connect — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the demo dashboard (commit `7e0146f`, in-memory store, placeholder login and connect) into the real product. Every page and server action reads and writes Postgres, scoped to the signed-in user's workspace. Sign-up and login use Better Auth. Instagram and Facebook accounts connect through Meta OAuth, which stores an encrypted token and subscribes webhooks. Publishing writes immutable `automation_versions` and pushes conversation starters to Meta.

**Architecture:** `apps/web/src/lib/data/*` becomes a set of Drizzle repositories. Every function takes `workspaceId` first and filters by it, which is the ownership check. `lib/workspaces.ts` resolves (or creates) the user's workspace under a per-user advisory lock. `lib/session.ts` turns the Better Auth session into a `WorkspaceContext` and is the only entry point pages, actions and route handlers use. Meta OAuth HTTP calls live in `packages/meta/src/oauth.ts` (stateless, msw-tested). `apps/web/src/lib/connect.ts` saves accounts and subscribes webhooks. Web tests run against a real Postgres (Testcontainers) with Meta mocked by msw, the same setup as the worker.

**Tech Stack:** Plan 1/2 stack + Next.js 16.3 (App Router, `proxy.ts`), Better Auth 1.7 (Drizzle adapter, `nextCookies`), msw 3 in web tests, tsx for the demo seed script.

**Spec:** `docs/superpowers/specs/2026-10-05-replyooo-design.md` (§3.1–3.2, §5.1–5.4, §6, §7)
**Previous plans:** `2026-10-05-plan-1-foundation-and-engine.md`, `2026-10-06-plan-2-meta-and-worker.md`. The Plan 3 UI (`7e0146f`) shipped without a written plan, so this document is "Plan 3b".

**Roadmap after this plan (unchanged from Plan 2):**
- Plan 4: Dodo billing and **plan-limit enforcement** (worker `inbound.ts` + connect/publish checks), email sending (invites, password reset, email verification, reauth emails), Meta deauthorize/data-deletion callbacks, legal pages, Dockerfiles + Dokploy, Sentry, bull-board, App Review.

## Global Constraints

- All Plan 1 and Plan 2 constraints still apply (TypeScript strict ESM, `import type`, `noUncheckedIndexedAccess`, internal packages export `./src/index.ts`, Postgres 18 `uuidv7()`).
- `apps/web` is **Next.js 16.3.8**. Middleware is now `src/proxy.ts` exporting `proxy`. Before writing Next-specific code, read the relevant page under `apps/web/node_modules/next/dist/docs/` (required by `apps/web/AGENTS.md`).
- Better Auth **1.7.x** with `better-auth/adapters/drizzle` (`provider: 'pg'`). Tables are `user`, `session`, `account` and `verification` with snake_case columns, defined in `packages/db/src/schema.ts` as `authUsers`, `authSessions`, `authAccounts` and `authVerifications`. `nextCookies()` is the last plugin, and only the app instance uses it (tests leave it out).
- **Ownership:** every function in `apps/web/src/lib/data/` takes `workspaceId` as its first argument and includes `eq(<table>.workspaceId, workspaceId)` (directly or through a join) in every query. IDs that come from a request go through `isUuid()` first. A malformed ID means "not found" and never reaches Postgres (avoids a 500 from `invalid input syntax for type uuid`).
- **Every server action and route handler** calls `requireWorkspace()` or `getCurrentAccount()` itself. `proxy.ts` is only an optimistic redirect (Next docs: "Always verify authentication and authorization inside each Server Function").
- Roles: `owner` and `admin` can invite/remove members and revoke invites; only `owner` can delete the workspace; everyone can edit automations.
- Invitations are accepted **only for users whose `emailVerified` is true** (Google sign-in today). Email/password users can't prove they own an address until Plan 4 adds email verification.
- When no valid workspace cookie exists, the default workspace is the user's **most recently joined** membership.
- Cookies set by the app: `httpOnly`, `sameSite: 'lax'`, `path: '/'`, `secure` in production (`COOKIE_OPTIONS` in `lib/session.ts`).
- Tokens are encrypted with `encryptToken` from `@replyooo/db` using `TOKEN_ENCRYPTION_KEY` (the same format the worker decrypts).
- Meta OAuth:
  - Instagram uses **Instagram API with Instagram Login**: authorize `https://www.instagram.com/oauth/authorize`; code exchange `POST https://api.instagram.com/oauth/access_token` (form-encoded); long-lived token `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token`; profile `GET https://graph.instagram.com/<v>/me?fields=user_id,username,name,profile_picture_url,account_type,followers_count`. Scopes: `instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments`. `external_id` = `user_id`. Accounts whose `account_type` is not `BUSINESS` or `MEDIA_CREATOR` are rejected.
  - Facebook uses **Facebook Login for Business**: `https://www.facebook.com/<v>/dialog/oauth` with `config_id=META_LOGIN_CONFIG_ID` when set, otherwise `scope=pages_show_list,pages_messaging,pages_manage_metadata,pages_read_engagement,pages_manage_engagement`. Flow: code → user token → long-lived user token → `me/accounts` page tokens (these don't expire, so `token_expires_at` is null). The user picks Pages inside Meta's dialog, and every granted Page is connected.
  - Redirect URI: `${APP_URL}/api/meta/oauth/<platform>/callback`. State: a random nonce stored in an httpOnly cookie `replyooo_oauth` as `<platform>:<nonce>`, valid for 10 minutes and deleted on callback.
- A connected account belongs to exactly one workspace forever (unique `(platform, external_id)`). Reconnecting in the same workspace refreshes the token and sets `status = 'active'`. An account in another workspace is refused and **never moved**, because the worker matches automations by account ID.
- Conversation starters: at most one live `ice_breaker` automation per account. Publishing or resuming one pauses the others and pushes its items with payload `encodePostback({ kind: 'ice_breaker', automationId, itemIndex })`. Pausing or deleting the live one clears them (best effort). If Meta rejects a push, the publish or resume is rolled back.
- Stats window: 30 days. "DMs sent" = `messages` with `direction = 'out'`, `status = 'sent'` and `kind IN ('dm', 'private_reply')`. A "lead" = a contact with `email` or `phone`.
- New dependency versions: `better-auth@^1.7.7`, `msw@^3.0.2` (web dev), `@testcontainers/postgresql@^12.2.0` (web dev), `tsx@^4.23.15` (web dev). Reuse the workspace's existing `drizzle-orm@^0.45.3` and `zod@^4.6.5`.
- Not in this plan: plan-limit enforcement, Dodo, sending any email, Meta deauthorize/data-deletion callbacks, Dockerfiles, Sentry (all Plan 4).

## Review Focus

1. **Another workspace's ID, or a malformed one like `aut_breakfast`, passed to a URL or server action** → treated as "not found": nothing changes and there's no 500. Tests: Task 6 `workspace isolation`, Task 5 `accounts are scoped to their workspace`, Task 8 `never returns another workspace's contacts`.
2. **A brand-new user's first page load fires several requests at once** (layout + page + server components) → exactly one workspace is created. Test: Task 3 `creates exactly one workspace when first requests race`.
3. **Connecting an account that's already connected** → same workspace: token refreshed, status back to `active`, no duplicate row. Another workspace: refused, and that workspace's row is untouched. Tests: Task 11 `reconnecting refreshes the token…` and `refuses an account owned by another workspace`.
4. **A second conversation-starter automation published on the same account, or Meta refusing the push** → the first is paused and Meta has the new questions. If Meta refuses, nothing is published and a revoked token flags the account. Tests: Task 7 `publishing a second conversation starter pauses the first` and `a Meta rejection rolls the publish back`.
5. **Someone signs up with email/password using an address a workspace invited** → they don't join that workspace (the email is unverified). Test: Task 3 `does not let an unverified email accept an invitation`.

---

## File Structure

```
.env.example                              + web variables (APP_URL, BETTER_AUTH_SECRET, Google, META_LOGIN_CONFIG_ID)
packages/
  db/src/schema.ts                        + Better Auth tables, workspace_invitations, connected_accounts.followers_count,
                                            workspace_members.user_id → user.id FK
  db/migrations/0002_auth_and_invitations.sql   generated
  db/test/auth-schema.test.ts
  shared/src/plans.ts                     PLAN_LIMITS, usagePeriod, periodEnd
  shared/test/plans.test.ts
  meta/src/graph.ts                       token becomes optional
  meta/src/oauth.ts                       authorize URLs + code exchange (Instagram, Facebook)
  meta/test/oauth.test.ts
apps/web/
  package.json, next.config.ts, tsconfig.json, vitest.config.ts
  scripts/seed-demo.ts                    local demo login + data (no Meta calls)
  src/proxy.ts                            optimistic auth redirect
  src/lib/env.ts                          Zod env (lazy)
  src/lib/db.ts                           Drizzle pool singleton
  src/lib/auth.ts                         createAuth / auth() / authErrorMessage / googleEnabled
  src/lib/redirects.ts                    safeNext
  src/lib/workspaces.ts                   resolveWorkspace, listWorkspaces, canManage (no Next imports)
  src/lib/session.ts                      getSessionUser, requireWorkspace, getCurrentAccount, cookies
  src/lib/meta.ts                         adapterFor, credentialsFor, tokenKey
  src/lib/connect.ts                      OAuth state, saveConnectedAccount, completeConnect
  src/lib/csv.ts                          csvCell / toCsv
  src/lib/data/index.ts                   barrel
  src/lib/data/ids.ts                     isUuid
  src/lib/data/types.ts                   view types
  src/lib/data/accounts.ts                listAccounts, getAccount, disconnectAccount
  src/lib/data/automations.ts             list/get/create/saveDraft/publish/status/delete + stats
  src/lib/data/ice-breakers.ts            iceBreakerItems, pushIceBreakers
  src/lib/data/contacts.ts                listContacts, countContacts, listTags, getContactDetail, listLatestLeads,
                                          getHomeStats, messageText
  src/lib/data/workspace.ts               members, invitations, subscription, deleteWorkspace
  src/lib/data/memory.ts, seed.ts         (temporary; deleted by Task 9)
  src/app/auth-actions.ts                 signIn, signUp, signInWithGoogle, signOut
  src/app/actions.ts                      workspace-scoped dashboard actions
  src/app/api/auth/[...all]/route.ts      Better Auth handler
  src/app/api/meta/oauth/[platform]/start/route.ts
  src/app/api/meta/oauth/[platform]/callback/route.ts
  src/components/auth-form.tsx            client form with errors + Google
  test/global-setup.ts, test/setup.ts, test/support.ts
  test/*.test.ts
```

**Transition note:** Tasks 5–9 move the dashboard off the in-memory store one domain at a time. Task 5 renames `lib/data/index.ts` to `lib/data/memory.ts` and turns `index.ts` into a barrel that re-exports both the new Drizzle modules and whatever `memory.ts` still holds. Each task deletes what it replaces, so `pnpm typecheck` and `pnpm test` pass after every task. Pages may show empty data between tasks; that's expected.

---

### Task 1: DB: Better Auth tables, invitations, follower counts + plan limits

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/migrations/0002_auth_and_invitations.sql` (generated) + `migrations/meta/*` (generated)
- Create: `packages/shared/src/plans.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/db/test/auth-schema.test.ts`, `packages/shared/test/plans.test.ts`

**Interfaces:**
- Produces (`@replyooo/db`): tables `authUsers` (`user`), `authSessions` (`session`), `authAccounts` (`account`), `authVerifications` (`verification`), `workspaceInvitations` (`workspace_invitations`: `id, workspaceId, email, role, invitedByUserId, createdAt, updatedAt`; unique `(workspace_id, email)`); `connectedAccounts.followersCount: number | null`; `workspaceMembers.userId` references `authUsers.id` on delete cascade.
- Produces (`@replyooo/shared`):
  ```ts
  type PlanKey = 'free' | 'pro' | 'business'
  interface PlanLimits { contactsPerMonth: number; connectedAccounts: number; liveAutomations: number | null }
  const PLAN_LIMITS: Record<PlanKey, PlanLimits>
  function usagePeriod(date: Date): string   // 'YYYY-MM' (UTC), same as worker usage_counters.period
  function periodEnd(date: Date): Date       // first instant of the next UTC month
  ```

- [ ] **Step 1: Write the failing tests**

`packages/shared/test/plans.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { PLAN_LIMITS, periodEnd, usagePeriod } from '../src'

describe('plans', () => {
  it('has a contact limit for every plan', () => {
    expect(PLAN_LIMITS.free.contactsPerMonth).toBe(1_000)
    expect(PLAN_LIMITS.pro.contactsPerMonth).toBe(5_000)
    expect(PLAN_LIMITS.business.contactsPerMonth).toBe(25_000)
  })

  it('uses UTC months for usage periods', () => {
    expect(usagePeriod(new Date('2026-12-31T23:59:59.000Z'))).toBe('2026-12')
    expect(periodEnd(new Date('2026-12-31T23:59:59.000Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z')
    expect(periodEnd(new Date('2026-10-06T10:00:00.000Z')).toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })
})
```

`packages/db/test/auth-schema.test.ts`:
```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../src'
import { authUsers, createDb, workspaceInvitations, workspaceMembers, workspaces } from '../src'

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

function one<T>(rows: T[]): T {
  const row = rows[0]
  if (!row) throw new Error('expected a row')
  return row
}

describe('auth and invitation tables', () => {
  it('rejects two users with the same email', async () => {
    await db.insert(authUsers).values({ id: 'u_dup_1', name: 'A', email: 'dup@example.com' })
    await expect(db.insert(authUsers).values({ id: 'u_dup_2', name: 'B', email: 'dup@example.com' })).rejects.toThrow()
  })

  it('removes memberships when the user is deleted', async () => {
    await db.insert(authUsers).values({ id: 'u_gone', name: 'Gone', email: 'gone@example.com' })
    const workspace = one(await db.insert(workspaces).values({ name: 'W', ownerUserId: 'u_gone' }).returning())
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: 'u_gone', role: 'owner' })
    await db.delete(authUsers).where(eq(authUsers.id, 'u_gone'))
    expect(await db.select().from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspace.id))).toEqual([])
  })

  it('allows one pending invitation per email per workspace', async () => {
    const workspace = one(await db.insert(workspaces).values({ name: 'Invites', ownerUserId: 'nobody' }).returning())
    await db.insert(workspaceInvitations).values({ workspaceId: workspace.id, email: 'sam@example.com' })
    await expect(
      db.insert(workspaceInvitations).values({ workspaceId: workspace.id, email: 'sam@example.com' }),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @replyooo/shared test plans && pnpm --filter @replyooo/db test auth-schema`
Expected: FAIL. `PLAN_LIMITS` is not exported, and `authUsers` / `workspaceInvitations` don't exist.

- [ ] **Step 3: Add the plans module**

`packages/shared/src/plans.ts`:
```ts
export type PlanKey = 'free' | 'pro' | 'business'

export interface PlanLimits {
  contactsPerMonth: number
  connectedAccounts: number
  /** null = unlimited */
  liveAutomations: number | null
}

/** Launch numbers (spec §3.6). Enforcement lands with billing in Plan 4. */
export const PLAN_LIMITS: Record<PlanKey, PlanLimits> = {
  free: { contactsPerMonth: 1_000, connectedAccounts: 1, liveAutomations: 3 },
  pro: { contactsPerMonth: 5_000, connectedAccounts: 3, liveAutomations: null },
  business: { contactsPerMonth: 25_000, connectedAccounts: 10, liveAutomations: null },
}

/** `YYYY-MM` in UTC, the key of `usage_counters.period`. */
export function usagePeriod(date: Date): string {
  return date.toISOString().slice(0, 7)
}

/** First instant of the next UTC month: when a free plan's usage resets. */
export function periodEnd(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
}
```

Append to `packages/shared/src/index.ts`:
```ts
export * from './plans'
```

- [ ] **Step 4: Add the auth tables, invitations and follower count to the schema**

In `packages/db/src/schema.ts`, add `boolean` to the `drizzle-orm/pg-core` import list. Then insert this block directly **above** `// ---------- tenancy ----------`:
```ts
// ---------- auth (Better Auth core schema; the adapter maps by property name) ----------

export const authUsers = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  ...timestamps,
})

export const authSessions = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: tz('expires_at').notNull(),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [index('session_user_id_idx').on(t.userId)],
)

export const authAccounts = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: tz('access_token_expires_at'),
    refreshTokenExpiresAt: tz('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    ...timestamps,
  },
  (t) => [index('account_user_id_idx').on(t.userId)],
)

export const authVerifications = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: tz('expires_at').notNull(),
    ...timestamps,
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
)
```

In `workspaceMembers`, change the `userId` column to:
```ts
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
```
(Leave `workspaces.ownerUserId` without a foreign key. Worker and db tests insert workspaces with made-up owner IDs.)

Directly below `workspaceMembers`, add:
```ts
export const workspaceInvitations = pgTable(
  'workspace_invitations',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Always lower-case. */
    email: text('email').notNull(),
    role: memberRoleEnum('role').notNull().default('member'),
    invitedByUserId: text('invited_by_user_id'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('workspace_invitations_workspace_email_uq').on(t.workspaceId, t.email),
    index('workspace_invitations_email_idx').on(t.email),
  ],
)
```

In `connectedAccounts`, add after `avatarUrl`:
```ts
    followersCount: integer('followers_count'),
```

- [ ] **Step 5: Generate the migration and inspect it**

Run: `pnpm --filter @replyooo/db db:generate --name auth_and_invitations`
Expected: a new `packages/db/migrations/0002_auth_and_invitations.sql` that contains `CREATE TABLE "user"`, `"session"`, `"account"`, `"verification"`, `"workspace_invitations"`, `ALTER TABLE "connected_accounts" ADD COLUMN "followers_count" integer`, and a foreign key from `workspace_members.user_id` to `user.id`. It must not drop or rename any existing column. If drizzle-kit asks an interactive rename question, the schema edit is wrong, so fix it instead of answering.

- [ ] **Step 6: Run the tests to verify they pass, including the existing suites**

Run: `pnpm --filter @replyooo/shared test && pnpm --filter @replyooo/db test && pnpm --filter @replyooo/worker test`
Expected: all PASS. The worker suite proves the new FK doesn't break its fixtures.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/plans.ts packages/shared/src/index.ts packages/shared/test/plans.test.ts \
  packages/db/src/schema.ts packages/db/migrations packages/db/test/auth-schema.test.ts
git commit -m "feat(db): add Better Auth tables, workspace invitations and plan limits"
```

---

### Task 2: Web: Postgres test harness, env and DB client

**Files:**
- Modify: `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/vitest.config.ts`, `apps/web/tsconfig.json`, `.env.example`
- Create: `apps/web/src/lib/env.ts`, `apps/web/src/lib/db.ts`, `apps/web/src/lib/data/ids.ts`
- Create: `apps/web/test/global-setup.ts`, `apps/web/test/setup.ts`, `apps/web/test/support.ts`
- Test: `apps/web/test/env.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // lib/env.ts
  interface Env { DATABASE_URL; APP_URL; BETTER_AUTH_SECRET; TOKEN_ENCRYPTION_KEY; META_APP_ID; META_APP_SECRET;
                  META_LOGIN_CONFIG_ID?; INSTAGRAM_APP_ID; INSTAGRAM_APP_SECRET; META_GRAPH_VERSION; GOOGLE_CLIENT_ID?; GOOGLE_CLIENT_SECRET? }
  function parseEnv(source: Record<string, string | undefined>): Env
  function env(): Env                      // parsed once, lazily
  // lib/db.ts
  function db(): Db
  function closeDb(): Promise<void>
  // lib/data/ids.ts
  function isUuid(value: string): boolean
  // test/support.ts
  function one<T>(rows: T[]): T
  function createUser(overrides?: { name?: string; email?: string; emailVerified?: boolean }): Promise<typeof authUsers.$inferSelect>
  function createWorkspace(name?: string): Promise<{ workspaceId: string; user: typeof authUsers.$inferSelect }>
  function createAccount(workspaceId: string, platform?: Platform, overrides?: Partial<typeof connectedAccounts.$inferInsert>): Promise<typeof connectedAccounts.$inferSelect>
  ```

- [ ] **Step 1: Add dependencies**

In `apps/web/package.json`:
- add to `dependencies`: `"@replyooo/db": "workspace:*"`, `"@replyooo/meta": "workspace:*"`, `"better-auth": "^1.7.7"`, `"drizzle-orm": "^0.45.3"`, `"zod": "^4.6.5"`
- add to `devDependencies`: `"@testcontainers/postgresql": "^12.2.0"`, `"msw": "^3.0.2"`, `"tsx": "^4.23.15"`

Run: `pnpm install`
Expected: lockfile updated, no peer-dependency errors for `better-auth` (it accepts `next ^16`, `drizzle-orm ^0.45.2`, `vitest ^5`).

In `apps/web/next.config.ts`, change `transpilePackages` to:
```ts
  transpilePackages: ['@replyooo/shared', '@replyooo/engine', '@replyooo/db', '@replyooo/meta'],
```

In `apps/web/tsconfig.json`, change `include` to:
```json
  "include": ["next-env.d.ts", "src", "test", "scripts", ".next/types/**/*.ts"],
```

- [ ] **Step 2: Write the failing test**

`apps/web/test/env.test.ts`:
```ts
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { isUuid } from '@/lib/data/ids'
import { db } from '@/lib/db'
import { parseEnv } from '@/lib/env'

const base = {
  DATABASE_URL: 'postgres://localhost/replyooo',
  APP_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  TOKEN_ENCRYPTION_KEY: 'key',
  META_APP_ID: 'fb-app',
  META_APP_SECRET: 'fb-secret',
  INSTAGRAM_APP_ID: 'ig-app',
  INSTAGRAM_APP_SECRET: 'ig-secret',
}

describe('parseEnv', () => {
  it('treats blank optional values as unset and defaults the Graph version', () => {
    const env = parseEnv({ ...base, GOOGLE_CLIENT_ID: '', META_LOGIN_CONFIG_ID: '', META_GRAPH_VERSION: '' })
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined()
    expect(env.META_LOGIN_CONFIG_ID).toBeUndefined()
    expect(env.META_GRAPH_VERSION).toBe('v24.0')
  })

  it('rejects a short auth secret and a missing Meta app', () => {
    expect(() => parseEnv({ ...base, BETTER_AUTH_SECRET: 'short' })).toThrow()
    expect(() => parseEnv({ ...base, META_APP_ID: '' })).toThrow()
  })
})

describe('isUuid', () => {
  it('accepts uuids and rejects demo ids', () => {
    expect(isUuid('0199b3a4-7c1e-7d2a-9f00-3c5e8a1b2c3d')).toBe(true)
    expect(isUuid('aut_breakfast')).toBe(false)
    expect(isUuid('')).toBe(false)
  })
})

describe('db', () => {
  it('connects to the migrated test database', async () => {
    const rows = await db().execute(sql`select count(*)::int as n from "user"`)
    expect(rows[0]).toHaveProperty('n')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @replyooo/web test env`
Expected: FAIL. `@/lib/env`, `@/lib/db` and `@/lib/data/ids` can't be resolved.

- [ ] **Step 4: Add env, db and ids modules**

`apps/web/src/lib/env.ts`:
```ts
import 'server-only'
import { z } from 'zod'

const blank = (value: unknown) => (value === '' ? undefined : value)
const required = z.string().min(1)
const optional = z.preprocess(blank, z.string().min(1).optional())

const EnvSchema = z.object({
  DATABASE_URL: required,
  /** Public origin of the web app, e.g. https://app.replyooo.com. Also the Better Auth base URL. */
  APP_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  TOKEN_ENCRYPTION_KEY: required,
  META_APP_ID: required,
  META_APP_SECRET: required,
  /** Facebook Login for Business configuration; falls back to plain scopes when unset. */
  META_LOGIN_CONFIG_ID: optional,
  INSTAGRAM_APP_ID: required,
  INSTAGRAM_APP_SECRET: required,
  META_GRAPH_VERSION: z.preprocess(blank, z.string().default('v24.0')),
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
})

export type Env = z.infer<typeof EnvSchema>

export function parseEnv(source: Record<string, string | undefined>): Env {
  return EnvSchema.parse(source)
}

let cached: Env | undefined

/** Parsed on first use so `next build` doesn't need production secrets. */
export function env(): Env {
  cached ??= parseEnv(process.env)
  return cached
}
```

`apps/web/src/lib/db.ts`:
```ts
import 'server-only'
import { createDb, type Db } from '@replyooo/db'
import { env } from './env'

type Handle = ReturnType<typeof createDb>
const store = globalThis as { __replyoooDb?: Handle }

/** One pool per process, kept on globalThis so dev-server reloads don't open new pools. */
export function db(): Db {
  store.__replyoooDb ??= createDb(env().DATABASE_URL)
  return store.__replyoooDb.db
}

export async function closeDb(): Promise<void> {
  await store.__replyoooDb?.close()
  store.__replyoooDb = undefined
}
```

`apps/web/src/lib/data/ids.ts`:
```ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Request-supplied IDs are checked before they reach a uuid column (Postgres would throw a 500). */
export function isUuid(value: string): boolean {
  return UUID.test(value)
}
```

- [ ] **Step 5: Add the Postgres test harness**

`apps/web/test/global-setup.ts`:
```ts
import { createDb } from '@replyooo/db'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { fileURLToPath } from 'node:url'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string
  }
}

export default async function setup(project: TestProject) {
  const postgres = await new PostgreSqlContainer('postgres:18-alpine').start()
  const databaseUrl = postgres.getConnectionUri()

  const { db, close } = createDb(databaseUrl)
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)),
  })
  await close()

  project.provide('databaseUrl', databaseUrl)
  return async () => {
    await postgres.stop()
  }
}
```

`apps/web/test/setup.ts`:
```ts
import { afterAll, inject } from 'vitest'
import { closeDb } from '@/lib/db'

// Runs before each test file is imported, so env() and db() see these values.
process.env.DATABASE_URL = inject('databaseUrl')
process.env.APP_URL = 'http://localhost:3000'
process.env.BETTER_AUTH_SECRET = 'test-secret-test-secret-test-secret-0000'
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
process.env.META_APP_ID = 'fb-app'
process.env.META_APP_SECRET = 'fb-secret'
process.env.INSTAGRAM_APP_ID = 'ig-app'
process.env.INSTAGRAM_APP_SECRET = 'ig-secret'
process.env.META_GRAPH_VERSION = 'v24.0'

afterAll(closeDb)
```

`apps/web/test/support.ts`:
```ts
import { authUsers, connectedAccounts, encryptToken, workspaceMembers, workspaces } from '@replyooo/db'
import type { Platform } from '@replyooo/shared'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'

export const TOKEN_KEY = Buffer.alloc(32, 7)

export function one<T>(rows: T[]): T {
  const row = rows[0]
  if (!row) throw new Error('expected a row')
  return row
}

export async function createUser(overrides: { name?: string; email?: string; emailVerified?: boolean } = {}) {
  const id = randomUUID()
  return one(
    await db()
      .insert(authUsers)
      .values({
        id,
        name: overrides.name ?? 'Test User',
        email: overrides.email ?? `${id}@example.com`,
        emailVerified: overrides.emailVerified ?? false,
      })
      .returning(),
  )
}

/** A workspace with an owner, the shape resolveWorkspace creates. */
export async function createWorkspace(name = 'Acme') {
  const user = await createUser({ name: `${name} Owner` })
  const workspace = one(await db().insert(workspaces).values({ name, ownerUserId: user.id }).returning())
  await db().insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
  return { workspaceId: workspace.id, user }
}

export async function createAccount(
  workspaceId: string,
  platform: Platform = 'instagram',
  overrides: Partial<typeof connectedAccounts.$inferInsert> = {},
) {
  return one(
    await db()
      .insert(connectedAccounts)
      .values({
        workspaceId,
        platform,
        externalId: `ext_${randomUUID()}`,
        username: platform === 'instagram' ? 'maya.makes' : 'mayamakeskitchen',
        displayName: 'Maya Makes',
        followersCount: 1_200,
        accessTokenEnc: encryptToken('stored-token', TOKEN_KEY),
        ...overrides,
      })
      .returning(),
  )
}
```

Replace `apps/web/vitest.config.ts` with:
```ts
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./test/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    hookTimeout: 120_000,
    testTimeout: 30_000,
    // Test files share one database.
    fileParallelism: false,
  },
})
```

Append to the root `.env.example`:
```
# ---------- web (copy into apps/web/.env.local) ----------
APP_URL=http://localhost:3000
# 32+ random characters: openssl rand -base64 32
BETTER_AUTH_SECRET=
# Optional: Facebook Login for Business configuration ID (otherwise plain scopes are requested)
META_LOGIN_CONFIG_ID=
# Optional: enables "Continue with Google"
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @replyooo/web test && pnpm --filter @replyooo/web typecheck`
Expected: PASS. That covers the new `env.test.ts` and the existing `recipe.test.ts` / `data.test.ts`, which don't touch the DB. Typecheck is clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/next.config.ts apps/web/tsconfig.json apps/web/vitest.config.ts \
  apps/web/src/lib/env.ts apps/web/src/lib/db.ts apps/web/src/lib/data/ids.ts apps/web/test .env.example pnpm-lock.yaml
git commit -m "feat(web): add Postgres test harness, env parsing and DB client"
```

---

### Task 3: Workspace resolution

**Files:**
- Create: `apps/web/src/lib/workspaces.ts`
- Test: `apps/web/test/workspaces.test.ts`

**Interfaces:**
- Consumes: `authUsers`, `workspaces`, `workspaceMembers`, `workspaceInvitations`, `subscriptions` (Task 1); `db()` and `createUser` / `createWorkspace` (Task 2).
- Produces:
  ```ts
  type Role = 'owner' | 'admin' | 'member'
  interface SessionUser { id: string; name: string; email: string; emailVerified: boolean }
  interface WorkspaceContext { workspaceId: string; workspaceName: string; role: Role; user: SessionUser }
  interface WorkspaceSummary { id: string; name: string; role: Role }
  function canManage(role: Role): boolean                                  // owner | admin
  function listWorkspaces(db: Db | Tx, userId: string): Promise<WorkspaceSummary[]>   // most recently joined first
  function resolveWorkspace(db: Db, user: SessionUser, preferredId?: string | null): Promise<WorkspaceContext>
  function workspaceNameFor(user: { name: string; email: string }): string
  ```
  This module has **no** Next.js imports, so tests and the seed script can use it.

- [ ] **Step 1: Write the failing test**

`apps/web/test/workspaces.test.ts`:
```ts
import { subscriptions, workspaceInvitations, workspaces } from '@replyooo/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { listWorkspaces, resolveWorkspace, type SessionUser } from '@/lib/workspaces'
import { createUser, createWorkspace } from './support'

const asSession = (u: { id: string; name: string; email: string; emailVerified: boolean }): SessionUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  emailVerified: u.emailVerified,
})

describe('resolveWorkspace', () => {
  it('creates a personal workspace on a free plan the first time', async () => {
    const user = await createUser({ name: 'Maya Lopez' })
    const ws = await resolveWorkspace(db(), asSession(user))
    expect(ws).toMatchObject({ workspaceName: "Maya's workspace", role: 'owner', user: { id: user.id } })
    const [subscription] = await db().select().from(subscriptions).where(eq(subscriptions.workspaceId, ws.workspaceId))
    expect(subscription?.plan).toBe('free')
  })

  it('returns the same workspace on later calls', async () => {
    const user = await createUser()
    const first = await resolveWorkspace(db(), asSession(user))
    const second = await resolveWorkspace(db(), asSession(user))
    expect(second.workspaceId).toBe(first.workspaceId)
  })

  it('creates exactly one workspace when first requests race', async () => {
    const user = await createUser()
    const results = await Promise.all(Array.from({ length: 5 }, () => resolveWorkspace(db(), asSession(user))))
    expect(new Set(results.map((r) => r.workspaceId)).size).toBe(1)
    expect(await listWorkspaces(db(), user.id)).toHaveLength(1)
  })

  it('lets a verified invitee join the inviting workspace and lands them there', async () => {
    const { workspaceId } = await createWorkspace('Acme')
    const invitee = await createUser({ email: 'Sam@Example.com', emailVerified: true })
    await resolveWorkspace(db(), asSession(invitee)) // already has their own workspace
    await db().insert(workspaceInvitations).values({ workspaceId, email: 'sam@example.com', role: 'admin' })

    const ws = await resolveWorkspace(db(), asSession(invitee))
    expect(ws).toMatchObject({ workspaceId, workspaceName: 'Acme', role: 'admin' })
    expect(await db().select().from(workspaceInvitations).where(eq(workspaceInvitations.workspaceId, workspaceId))).toEqual([])
    expect(await listWorkspaces(db(), invitee.id)).toHaveLength(2)
  })

  it('does not let an unverified email accept an invitation', async () => {
    const { workspaceId } = await createWorkspace('Private')
    await db().insert(workspaceInvitations).values({ workspaceId, email: 'squatter@example.com' })
    const squatter = await createUser({ email: 'squatter@example.com', emailVerified: false })

    const ws = await resolveWorkspace(db(), asSession(squatter))
    expect(ws.workspaceId).not.toBe(workspaceId)
    expect(await db().select().from(workspaceInvitations).where(eq(workspaceInvitations.workspaceId, workspaceId))).toHaveLength(1)
  })

  it('honours a preferred workspace only when the user is a member', async () => {
    const { workspaceId: acme } = await createWorkspace('Acme Two')
    const { workspaceId: stranger } = await createWorkspace('Stranger')
    const user = await createUser({ email: 'pat@example.com', emailVerified: true })
    const own = await resolveWorkspace(db(), asSession(user))
    await db().insert(workspaceInvitations).values({ workspaceId: acme, email: 'pat@example.com' })
    await resolveWorkspace(db(), asSession(user))

    expect((await resolveWorkspace(db(), asSession(user), own.workspaceId)).workspaceId).toBe(own.workspaceId)
    expect((await resolveWorkspace(db(), asSession(user), stranger)).workspaceId).toBe(acme)
    expect((await resolveWorkspace(db(), asSession(user), 'not-a-uuid')).workspaceId).toBe(acme)
  })

  it('creates a fresh workspace after the old one is deleted', async () => {
    const user = await createUser()
    const first = await resolveWorkspace(db(), asSession(user))
    await db().delete(workspaces).where(eq(workspaces.id, first.workspaceId))
    const second = await resolveWorkspace(db(), asSession(user))
    expect(second.workspaceId).not.toBe(first.workspaceId)
    expect(second.role).toBe('owner')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @replyooo/web test workspaces`
Expected: FAIL. `@/lib/workspaces` can't be resolved.

- [ ] **Step 3: Implement workspace resolution**

`apps/web/src/lib/workspaces.ts`:
```ts
import {
  type Db,
  subscriptions,
  type Tx,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from '@replyooo/db'
import { desc, eq, sql } from 'drizzle-orm'

export type Role = 'owner' | 'admin' | 'member'

export interface SessionUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
}

export interface WorkspaceContext {
  workspaceId: string
  workspaceName: string
  role: Role
  user: SessionUser
}

export interface WorkspaceSummary {
  id: string
  name: string
  role: Role
}

export const canManage = (role: Role) => role === 'owner' || role === 'admin'

/** The user's workspaces, most recently joined first. */
export async function listWorkspaces(db: Db | Tx, userId: string): Promise<WorkspaceSummary[]> {
  return db
    .select({ id: workspaces.id, name: workspaces.name, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(desc(workspaceMembers.createdAt), desc(workspaceMembers.id))
}

/**
 * The workspace a signed-in user is working in: the preferred one if they belong to it,
 * otherwise the one they joined most recently (so an accepted invite takes them there).
 * Accepts pending invitations for verified emails, and creates a personal workspace when
 * the user has none. Runs under a per-user advisory lock so parallel first requests can't
 * create two workspaces.
 */
export async function resolveWorkspace(
  db: Db,
  user: SessionUser,
  preferredId?: string | null,
): Promise<WorkspaceContext> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${user.id}))`)
    if (user.emailVerified) await acceptInvitations(tx, user)

    let memberships = await listWorkspaces(tx, user.id)
    if (memberships.length === 0) memberships = [await createPersonalWorkspace(tx, user)]

    const chosen = memberships.find((m) => m.id === preferredId) ?? memberships[0]
    if (!chosen) throw new Error('workspace resolution produced no membership')
    return { workspaceId: chosen.id, workspaceName: chosen.name, role: chosen.role, user }
  })
}

async function acceptInvitations(tx: Tx, user: SessionUser): Promise<void> {
  const invites = await tx
    .delete(workspaceInvitations)
    .where(eq(workspaceInvitations.email, user.email.toLowerCase()))
    .returning()
  for (const invite of invites) {
    await tx
      .insert(workspaceMembers)
      .values({ workspaceId: invite.workspaceId, userId: user.id, role: invite.role })
      .onConflictDoNothing()
  }
}

async function createPersonalWorkspace(tx: Tx, user: SessionUser): Promise<WorkspaceSummary> {
  const name = workspaceNameFor(user)
  const [workspace] = await tx.insert(workspaces).values({ name, ownerUserId: user.id }).returning({ id: workspaces.id })
  if (!workspace) throw new Error('workspace insert returned nothing')
  await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })
  await tx.insert(subscriptions).values({ workspaceId: workspace.id, plan: 'free' })
  return { id: workspace.id, name, role: 'owner' }
}

export function workspaceNameFor(user: { name: string; email: string }): string {
  const first = user.name.trim().split(/\s+/)[0]
  if (first) return `${first}'s workspace`
  return user.email.split('@')[0] || 'My workspace'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @replyooo/web test workspaces`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/workspaces.ts apps/web/test/workspaces.test.ts
git commit -m "feat(web): resolve and create workspaces for signed-in users"
```

---

### Task 4: Better Auth: email/password, Google, auth pages and proxy

**Files:**
- Create: `apps/web/src/lib/auth.ts`, `apps/web/src/lib/redirects.ts`, `apps/web/src/app/api/auth/[...all]/route.ts`, `apps/web/src/app/auth-actions.ts`, `apps/web/src/proxy.ts`
- Modify: `apps/web/src/components/auth-form.tsx`, `apps/web/src/app/(auth)/login/page.tsx`, `apps/web/src/app/(auth)/signup/page.tsx`, `apps/web/src/app/(auth)/layout.tsx`, `apps/web/src/lib/session.ts`, `apps/web/src/app/actions.ts`
- Test: `apps/web/test/auth.test.ts`, `apps/web/test/redirects.test.ts`

**Interfaces:**
- Consumes: `authUsers`, `authSessions`, `authAccounts`, `authVerifications` (Task 1); `env()` and `db()` (Task 2).
- Produces:
  ```ts
  // lib/auth.ts
  function createAuth(options: { db: Db; secret: string; baseURL: string;
                                 google?: { clientId: string; clientSecret: string }; nextCookies?: boolean }): Auth
  type Auth = ReturnType<typeof createAuth>
  function auth(): Auth                         // app singleton (nextCookies on)
  function googleEnabled(): boolean
  function authErrorMessage(error: unknown): string | null   // null = not an auth error, rethrow
  // lib/redirects.ts
  function safeNext(value: FormDataEntryValue | string | null | undefined, fallback: string): string
  // app/auth-actions.ts ('use server')
  type AuthState = { error: string } | null
  function signIn(state: AuthState, formData: FormData): Promise<AuthState>
  function signUp(state: AuthState, formData: FormData): Promise<AuthState>
  function signInWithGoogle(formData: FormData): Promise<void>
  function signOut(): Promise<void>
  // lib/session.ts (added)
  const getSessionUser: () => Promise<{ id; name; email; emailVerified; ... } | null>   // React cache()
  ```

Before writing code, read `apps/web/node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md` and `01-app/02-guides/authentication.md`.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/redirects.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { safeNext } from '@/lib/redirects'

describe('safeNext', () => {
  it('keeps same-origin paths', () => {
    expect(safeNext('/automations/123?tab=dm', '/home')).toBe('/automations/123?tab=dm')
  })

  it('falls back for anything that could leave the site', () => {
    for (const value of ['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', '', null, undefined]) {
      expect(safeNext(value, '/home')).toBe('/home')
    }
  })
})
```

`apps/web/test/auth.test.ts`:
```ts
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { authErrorMessage, createAuth } from '@/lib/auth'
import { db } from '@/lib/db'

const auth = createAuth({
  db: db(),
  secret: 'test-secret-test-secret-test-secret-0000',
  baseURL: 'http://localhost:3000',
})

const email = () => `person-${randomUUID()}@example.com`

function sessionCookie(headers: Headers): string {
  const cookie = headers.getSetCookie().find((c) => c.startsWith('better-auth.session_token='))
  if (!cookie) throw new Error('no session cookie was set')
  return cookie.split(';')[0] ?? ''
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the call to throw')
}

describe('email and password auth', () => {
  it('signs up and reads the session back from the cookie it set', async () => {
    const address = email()
    const { headers } = await auth.api.signUpEmail({
      body: { name: 'New Person', email: address, password: 'correct-horse' },
      returnHeaders: true,
    })
    const session = await auth.api.getSession({ headers: new Headers({ cookie: sessionCookie(headers) }) })
    expect(session?.user).toMatchObject({ email: address, name: 'New Person', emailVerified: false })
  })

  it('refuses a second account with the same email', async () => {
    const address = email()
    await auth.api.signUpEmail({ body: { name: 'One', email: address, password: 'correct-horse' } })
    const error = await caught(auth.api.signUpEmail({ body: { name: 'Two', email: address, password: 'correct-horse' } }))
    expect(authErrorMessage(error)).toBe('An account with this email already exists. Log in instead.')
  })

  it('rejects a wrong password with a friendly message', async () => {
    const address = email()
    await auth.api.signUpEmail({ body: { name: 'Three', email: address, password: 'correct-horse' } })
    const error = await caught(auth.api.signInEmail({ body: { email: address, password: 'wrong-horse' } }))
    expect(authErrorMessage(error)).toBe('Wrong email or password.')
  })

  it('rejects short passwords', async () => {
    const error = await caught(auth.api.signUpEmail({ body: { name: 'Four', email: email(), password: 'short' } }))
    expect(authErrorMessage(error)).toBe('Use at least 8 characters for your password.')
  })

  it('does not treat unrelated errors as auth errors', () => {
    expect(authErrorMessage(new Error('boom'))).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @replyooo/web test auth redirects`
Expected: FAIL. `@/lib/auth` and `@/lib/redirects` can't be resolved.

- [ ] **Step 3: Implement auth and redirects**

`apps/web/src/lib/redirects.ts`:
```ts
/** Only same-origin paths. Absolute URLs, `//host` and `/\host` fall back. */
export function safeNext(value: FormDataEntryValue | string | null | undefined, fallback: string): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return fallback
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback
  return value
}
```

`apps/web/src/lib/auth.ts`:
```ts
import 'server-only'
import { authAccounts, authSessions, authUsers, authVerifications, type Db } from '@replyooo/db'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { nextCookies } from 'better-auth/next-js'
import { db } from './db'
import { env } from './env'

export function createAuth(options: {
  db: Db
  secret: string
  baseURL: string
  google?: { clientId: string; clientSecret: string }
  /** Let server actions set cookies (app only; tests read Set-Cookie headers instead). */
  nextCookies?: boolean
}) {
  return betterAuth({
    secret: options.secret,
    baseURL: options.baseURL,
    database: drizzleAdapter(options.db, {
      provider: 'pg',
      schema: { user: authUsers, session: authSessions, account: authAccounts, verification: authVerifications },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    socialProviders: options.google ? { google: options.google } : {},
    // nextCookies must be the last plugin.
    plugins: options.nextCookies ? [nextCookies()] : [],
  })
}

export type Auth = ReturnType<typeof createAuth>

const store = globalThis as { __replyoooAuth?: Auth }

export function googleEnabled(): boolean {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env()
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET)
}

export function auth(): Auth {
  if (!store.__replyoooAuth) {
    const e = env()
    store.__replyoooAuth = createAuth({
      db: db(),
      secret: e.BETTER_AUTH_SECRET,
      baseURL: e.APP_URL,
      google:
        e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
          ? { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET }
          : undefined,
      nextCookies: true,
    })
  }
  return store.__replyoooAuth
}

/** A message to show on the form, or null when the error isn't Better Auth's (rethrow it). */
export function authErrorMessage(error: unknown): string | null {
  if (!(error instanceof APIError)) return null
  const code = String((error.body as { code?: unknown } | undefined)?.code ?? '')
  if (code.startsWith('USER_ALREADY_EXISTS')) return 'An account with this email already exists. Log in instead.'
  if (code === 'INVALID_EMAIL_OR_PASSWORD') return 'Wrong email or password.'
  if (code === 'PASSWORD_TOO_SHORT') return 'Use at least 8 characters for your password.'
  return error.message || 'Something went wrong. Try again.'
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @replyooo/web test auth redirects`
Expected: PASS. If `signUpEmail` rejects with "table user does not exist", the Task 1 migration didn't run. If a column is missing, compare the Task 1 tables against Better Auth's `@better-auth/core/dist/db/get-tables.mjs`.

- [ ] **Step 5: Wire Better Auth into the app**

`apps/web/src/app/api/auth/[...all]/route.ts`:
```ts
import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/lib/auth'

export const { GET, POST } = toNextJsHandler((request: Request) => auth().handler(request))
```

`apps/web/src/app/auth-actions.ts`:
```ts
'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth, authErrorMessage } from '@/lib/auth'
import { safeNext } from '@/lib/redirects'

export type AuthState = { error: string } | null

const text = (formData: FormData, name: string) => String(formData.get(name) ?? '').trim()

export async function signIn(_state: AuthState, formData: FormData): Promise<AuthState> {
  try {
    await auth().api.signInEmail({
      body: { email: text(formData, 'email'), password: String(formData.get('password') ?? '') },
      headers: await headers(),
    })
  } catch (error) {
    const message = authErrorMessage(error)
    if (message) return { error: message }
    throw error
  }
  redirect(safeNext(formData.get('next'), '/home'))
}

export async function signUp(_state: AuthState, formData: FormData): Promise<AuthState> {
  const email = text(formData, 'email')
  try {
    await auth().api.signUpEmail({
      body: {
        name: text(formData, 'name') || email.split('@')[0] || 'there',
        email,
        password: String(formData.get('password') ?? ''),
      },
      headers: await headers(),
    })
  } catch (error) {
    const message = authErrorMessage(error)
    if (message) return { error: message }
    throw error
  }
  redirect('/connect')
}

export async function signInWithGoogle(formData: FormData) {
  const result = await auth().api.signInSocial({
    body: { provider: 'google', callbackURL: safeNext(formData.get('next'), '/home'), newUserCallbackURL: '/connect' },
    headers: await headers(),
  })
  if (!('url' in result) || !result.url) throw new Error('Google sign-in is not configured')
  redirect(result.url)
}

export async function signOut() {
  await auth().api.signOut({ headers: await headers() })
  redirect('/login')
}
```

Replace `apps/web/src/components/auth-form.tsx` with:
```tsx
'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import type { AuthState } from '@/app/auth-actions'
import { buttonClass, cx } from './ui'

const field =
  'h-11 w-full rounded-xl border border-line bg-white px-3.5 text-[14px] outline-none transition-colors placeholder:text-faint focus:border-ink'

export function AuthForm({
  mode,
  action,
  googleAction,
  next,
}: {
  mode: 'login' | 'signup'
  action: (state: AuthState, formData: FormData) => Promise<AuthState>
  googleAction?: (formData: FormData) => Promise<void>
  next?: string
}) {
  const signup = mode === 'signup'
  const [state, formAction, pending] = useActionState(action, null)

  return (
    <>
      <h1 className="font-display text-[34px] leading-tight font-bold tracking-[-0.04em]">
        {signup ? 'Start free' : 'Welcome back'}
      </h1>
      <p className="mt-1.5 text-[15px] text-muted">
        {signup ? '1,000 contacts a month free. No card needed.' : 'Log in to your Replyooo workspace.'}
      </p>

      {googleAction && (
        <>
          <form action={googleAction} className="mt-8">
            {next && <input type="hidden" name="next" value={next} />}
            <button type="submit" className={cx(buttonClass('secondary'), 'h-11 w-full')}>
              <GoogleIcon /> Continue with Google
            </button>
          </form>
          <div className="my-4 flex items-center gap-3 text-[12px] text-subtle">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      <form action={formAction} className={cx('flex flex-col gap-3', !googleAction && 'mt-8')}>
        {next && <input type="hidden" name="next" value={next} />}
        {signup && <input name="name" placeholder="Your name" autoComplete="name" className={field} />}
        <input name="email" type="email" required placeholder="you@example.com" autoComplete="email" className={field} />
        <input
          name="password"
          type="password"
          required
          minLength={8}
          placeholder="Password"
          autoComplete={signup ? 'new-password' : 'current-password'}
          className={field}
        />
        {state?.error && (
          <p role="alert" className="text-[13px] font-medium text-[#c2330e]">
            {state.error}
          </p>
        )}
        <button type="submit" disabled={pending} className={cx(buttonClass('primary'), 'mt-2 h-11 w-full', pending && 'opacity-60')}>
          {signup ? 'Create account' : 'Log in'}
        </button>
      </form>
      <p className="mt-6 text-center text-[13.5px] text-muted">
        {signup ? 'Already have an account? ' : 'New to Replyooo? '}
        <Link href={signup ? '/login' : '/signup'} className="font-semibold text-ink underline-offset-2 hover:underline">
          {signup ? 'Log in' : 'Create one'}
        </Link>
      </p>
      {signup && (
        <p className="mt-4 text-center text-[12px] text-subtle">
          By signing up you agree to our <Link href="/terms" className="underline">Terms</Link> and{' '}
          <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </p>
      )}
    </>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z" />
    </svg>
  )
}
```

Replace `apps/web/src/app/(auth)/login/page.tsx` with:
```tsx
import type { Metadata } from 'next'
import { signIn, signInWithGoogle } from '@/app/auth-actions'
import { AuthForm } from '@/components/auth-form'
import { googleEnabled } from '@/lib/auth'

export const metadata: Metadata = { title: 'Log in' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  return <AuthForm mode="login" action={signIn} googleAction={googleEnabled() ? signInWithGoogle : undefined} next={next} />
}
```

Replace `apps/web/src/app/(auth)/signup/page.tsx` with:
```tsx
import type { Metadata } from 'next'
import { signInWithGoogle, signUp } from '@/app/auth-actions'
import { AuthForm } from '@/components/auth-form'
import { googleEnabled } from '@/lib/auth'

export const metadata: Metadata = { title: 'Sign up' }

export default function SignupPage() {
  return <AuthForm mode="signup" action={signUp} googleAction={googleEnabled() ? signInWithGoogle : undefined} />
}
```

Add `getSessionUser` to `apps/web/src/lib/session.ts`. Add these imports and the export, and leave the rest of the file unchanged:
```ts
import { headers } from 'next/headers'
import { cache } from 'react'
import { auth } from './auth'

/** The Better Auth user for this request, or null. Cached per request. */
export const getSessionUser = cache(async () => {
  const session = await auth().api.getSession({ headers: await headers() })
  return session?.user ?? null
})
```
(Merge `headers` into the existing `next/headers` import.)

In `apps/web/src/app/(auth)/layout.tsx`, make the layout redirect signed-in users. Change the imports and signature to:
```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Logo } from '@/components/ui'
import { getSessionUser } from '@/lib/session'

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getSessionUser()) redirect('/home')
```
(The JSX body is unchanged.)

`apps/web/src/proxy.ts`:
```ts
import { getSessionCookie } from 'better-auth/cookies'
import { type NextRequest, NextResponse } from 'next/server'

/**
 * Optimistic check only: no cookie → login. Pages, actions and route handlers still
 * verify the session themselves (lib/session.ts).
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next()
  const login = new URL('/login', request.url)
  login.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`)
  return NextResponse.redirect(login)
}

export const config = {
  matcher: [
    '/home',
    '/automations/:path*',
    '/contacts/:path*',
    '/settings/:path*',
    '/connect',
    '/api/contacts/:path*',
    '/api/meta/oauth/:path*',
  ],
}
```

In `apps/web/src/app/actions.ts`, delete the `signIn` and `signUp` placeholder actions at the bottom of the file.

- [ ] **Step 6: Verify types and the full web suite**

Run: `pnpm --filter @replyooo/web typecheck && pnpm --filter @replyooo/web test`
Expected: clean typecheck, all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src apps/web/test
git commit -m "feat(web): add Better Auth sign-up, login, Google and session proxy"
```

---

### Task 5: Session, workspace-scoped accounts and the switch off in-memory accounts

**Files:**
- Rename: `apps/web/src/lib/data/index.ts` → `apps/web/src/lib/data/memory.ts`
- Create: `apps/web/src/lib/data/index.ts` (barrel), `apps/web/src/lib/data/accounts.ts`
- Modify: `apps/web/src/lib/data/memory.ts`, `apps/web/src/lib/data/types.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/app/actions.ts`, `apps/web/src/app/connect/page.tsx`, `apps/web/src/app/(app)/settings/page.tsx`, `apps/web/src/app/(app)/automations/[id]/page.tsx`, `apps/web/src/components/sidebar.tsx`
- Test: `apps/web/test/accounts.test.ts`

**Interfaces:**
- Consumes: `resolveWorkspace`, `WorkspaceContext` (Task 3); `auth()`, `getSessionUser`, `signOut` (Task 4); `isUuid` (Task 2).
- Produces:
  ```ts
  // lib/data/types.ts (changed)
  interface ConnectedAccount { id: string; platform: Platform; username: string; displayName: string | null;
                               followers: number | null; status: 'active' | 'reauth_required' | 'disconnected' }
  // lib/data/accounts.ts
  function listAccounts(workspaceId: string): Promise<ConnectedAccount[]>        // excludes disconnected, oldest first
  function getAccount(workspaceId: string, id: string): Promise<ConnectedAccount | null>
  function disconnectAccount(workspaceId: string, id: string): Promise<void>
  // lib/session.ts
  const ACCOUNT_COOKIE = 'replyooo_account', WORKSPACE_COOKIE = 'replyooo_workspace'
  const COOKIE_OPTIONS: { path: '/'; sameSite: 'lax'; httpOnly: true; secure: boolean }
  const requireWorkspace: () => Promise<WorkspaceContext>        // redirects to /login
  function getCurrentAccount(): Promise<{ workspace: WorkspaceContext; account: ConnectedAccount; accounts: ConnectedAccount[] }>
  ```

- [ ] **Step 1: Write the failing test**

`apps/web/test/accounts.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { disconnectAccount, getAccount, listAccounts } from '@/lib/data/accounts'
import { createAccount, createWorkspace } from './support'

describe('accounts are scoped to their workspace', () => {
  it('lists only the workspace’s connected accounts, oldest first', async () => {
    const a = await createWorkspace('A')
    const b = await createWorkspace('B')
    const first = await createAccount(a.workspaceId, 'instagram')
    const second = await createAccount(a.workspaceId, 'facebook', { followersCount: null })
    await createAccount(a.workspaceId, 'instagram', { status: 'disconnected' })
    await createAccount(b.workspaceId, 'instagram')

    const accounts = await listAccounts(a.workspaceId)
    expect(accounts.map((x) => x.id)).toEqual([first.id, second.id])
    expect(accounts[1]).toMatchObject({ platform: 'facebook', followers: null, status: 'active' })
  })

  it('treats another workspace’s account or a malformed id as missing', async () => {
    const a = await createWorkspace('A')
    const b = await createWorkspace('B')
    const account = await createAccount(a.workspaceId)
    expect(await getAccount(b.workspaceId, account.id)).toBeNull()
    expect(await getAccount(a.workspaceId, 'acc_ig')).toBeNull()

    await disconnectAccount(b.workspaceId, account.id)
    expect(await getAccount(a.workspaceId, account.id)).toMatchObject({ status: 'active' })

    await disconnectAccount(a.workspaceId, account.id)
    expect(await listAccounts(a.workspaceId)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @replyooo/web test accounts`
Expected: FAIL. `@/lib/data/accounts` can't be resolved.

- [ ] **Step 3: Implement the accounts repository**

In `apps/web/src/lib/data/types.ts`, change `ConnectedAccount` to:
```ts
export interface ConnectedAccount {
  id: string
  platform: Platform
  username: string
  displayName: string | null
  followers: number | null
  status: 'active' | 'reauth_required' | 'disconnected'
}
```

`apps/web/src/lib/data/accounts.ts`:
```ts
import 'server-only'
import { connectedAccounts } from '@replyooo/db'
import { and, asc, eq, ne } from 'drizzle-orm'
import { db } from '../db'
import { isUuid } from './ids'
import type { ConnectedAccount } from './types'

const columns = {
  id: connectedAccounts.id,
  platform: connectedAccounts.platform,
  username: connectedAccounts.username,
  displayName: connectedAccounts.displayName,
  followers: connectedAccounts.followersCount,
  status: connectedAccounts.status,
}

export async function listAccounts(workspaceId: string): Promise<ConnectedAccount[]> {
  return db()
    .select(columns)
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.workspaceId, workspaceId), ne(connectedAccounts.status, 'disconnected')))
    .orderBy(asc(connectedAccounts.createdAt), asc(connectedAccounts.id))
}

export async function getAccount(workspaceId: string, id: string): Promise<ConnectedAccount | null> {
  if (!isUuid(id)) return null
  const [row] = await db()
    .select(columns)
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.workspaceId, workspaceId), eq(connectedAccounts.id, id)))
  return row ?? null
}

/** The account stays owned by this workspace; the worker ignores events for disconnected accounts. */
export async function disconnectAccount(workspaceId: string, id: string): Promise<void> {
  if (!isUuid(id)) return
  await db()
    .update(connectedAccounts)
    .set({ status: 'disconnected' })
    .where(and(eq(connectedAccounts.workspaceId, workspaceId), eq(connectedAccounts.id, id)))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @replyooo/web test accounts`
Expected: PASS.

- [ ] **Step 5: Split the in-memory store and add the barrel**

Run: `git mv apps/web/src/lib/data/index.ts apps/web/src/lib/data/memory.ts`

In `apps/web/src/lib/data/memory.ts`:
- delete the line `export type * from './types'`
- delete the functions `listAccounts`, `getAccount`, `setAccountStatus` and `connectDemoAccount` (they're replaced by `accounts.ts` and, in Task 11, the OAuth connect flow)

Create `apps/web/src/lib/data/index.ts`:
```ts
export type * from './types'
export * from './accounts'
export * from './memory'
```

- [ ] **Step 6: Make the session workspace-aware**

Replace `apps/web/src/lib/session.ts` with:
```ts
import 'server-only'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { auth } from './auth'
import { listAccounts } from './data/accounts'
import { db } from './db'
import { resolveWorkspace, type WorkspaceContext } from './workspaces'

export const ACCOUNT_COOKIE = 'replyooo_account'
export const WORKSPACE_COOKIE = 'replyooo_workspace'
export const COOKIE_OPTIONS = {
  path: '/',
  sameSite: 'lax',
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
} as const

/** The Better Auth user for this request, or null. Cached per request. */
export const getSessionUser = cache(async () => {
  const session = await auth().api.getSession({ headers: await headers() })
  return session?.user ?? null
})

/** Signed-in user + current workspace. Every page, action and route handler goes through this. */
export const requireWorkspace = cache(async (): Promise<WorkspaceContext> => {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const preferred = (await cookies()).get(WORKSPACE_COOKIE)?.value
  return resolveWorkspace(
    db(),
    { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified },
    preferred,
  )
})

/** The connected account the dashboard is scoped to (account switcher). */
export async function getCurrentAccount() {
  const workspace = await requireWorkspace()
  const accounts = await listAccounts(workspace.workspaceId)
  const selected = (await cookies()).get(ACCOUNT_COOKIE)?.value
  const account = accounts.find((a) => a.id === selected) ?? accounts[0]
  if (!account) redirect('/connect')
  return { workspace, account, accounts }
}
```

- [ ] **Step 7: Update the account call sites**

In `apps/web/src/app/actions.ts`:
- change the session import to `import { ACCOUNT_COOKIE, COOKIE_OPTIONS, getCurrentAccount, requireWorkspace } from '@/lib/session'`
- replace `switchAccount` and `disconnectAccount` with:
```ts
export async function switchAccount(accountId: string) {
  const { workspaceId } = await requireWorkspace()
  if (!(await data.getAccount(workspaceId, accountId))) return
  ;(await cookies()).set(ACCOUNT_COOKIE, accountId, COOKIE_OPTIONS)
  revalidatePath('/', 'layout')
}

export async function disconnectAccount(id: string) {
  const { workspaceId } = await requireWorkspace()
  await data.disconnectAccount(workspaceId, id)
  revalidatePath('/', 'layout')
}
```
- delete the `connectAccount` action. Task 11 replaces it with the OAuth routes.

In `apps/web/src/app/connect/page.tsx`:
- remove the `connectAccount` import, and add `import { requireWorkspace } from '@/lib/session'`
- change the data line to:
```tsx
  const { workspaceId } = await requireWorkspace()
  const [{ platform: highlight }, accounts] = await Promise.all([searchParams, listAccounts(workspaceId)])
```
- change each option's `<form key=… action={connectAccount.bind(null, option.platform)} className=…>` to `<div key={option.platform} className=…>` (same classes), and its closing `</form>` to `</div>`
- replace the `<button type="submit" …>Continue with …</button>` with a link to the OAuth start route (Task 11):
```tsx
                <a
                  href={`/api/meta/oauth/${option.platform}/start`}
                  className="mt-6 grid h-11 place-items-center rounded-full bg-ink text-[14px] font-semibold text-white transition-colors hover:bg-ink-2"
                >
                  Continue with {option.platform === 'instagram' ? 'Instagram' : 'Facebook'}
                </a>
```

In `apps/web/src/app/(app)/settings/page.tsx`:
- add `import { requireWorkspace } from '@/lib/session'`
- at the top of `SettingsPage`, add `const { workspaceId } = await requireWorkspace()` and change `listAccounts()` to `listAccounts(workspaceId)`
- replace `· {formatCompact(account.followers)} followers` with:
```tsx
                  {account.followers !== null && <> · {formatCompact(account.followers)} followers</>}
```

In `apps/web/src/app/(app)/automations/[id]/page.tsx`:
- add `import { requireWorkspace } from '@/lib/session'`
- change `const account = await getAccount(automation.accountId)` to:
```tsx
  const { workspaceId } = await requireWorkspace()
  const account = await getAccount(workspaceId, automation.accountId)
```

In `apps/web/src/components/sidebar.tsx`:
- add `LogOut` to the `lucide-react` import and `import { signOut } from '@/app/auth-actions'`
- in `AccountSwitcher`, replace `{formatCompact(account.followers)} followers` with:
```tsx
            {account.followers !== null
              ? `${formatCompact(account.followers)} followers`
              : account.platform === 'instagram'
                ? 'Instagram'
                : 'Facebook Page'}
```
- extract `NavLink`'s class expression into a function, and use it from `NavLink`:
```tsx
const navItemClass = (active: boolean) =>
  cx(
    'flex h-[38px] w-full items-center gap-3 rounded-[10px] px-3 text-[14.5px] transition-colors',
    active ? 'border border-line bg-white font-semibold text-ink shadow-[0_1px_2px_rgba(21,19,16,0.04)]' : 'text-muted hover:bg-white/60 hover:text-ink',
  )

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={navItemClass(active)}>
      {children}
    </Link>
  )
}
```
- after the Help `NavLink` in the bottom group, add:
```tsx
        <form action={signOut}>
          <button type="submit" className={navItemClass(false)}>
            <LogOut className="size-[18px]" strokeWidth={1.75} />
            Log out
          </button>
        </form>
```

- [ ] **Step 8: Verify**

Run: `pnpm --filter @replyooo/web typecheck && pnpm --filter @replyooo/web test`
Expected: clean typecheck, all tests PASS. (`data.test.ts` still uses the in-memory automations and contacts.)

- [ ] **Step 9: Commit**

```bash
git add -A apps/web/src apps/web/test
git commit -m "feat(web): scope the session and connected accounts to the signed-in workspace"
```

---
### Task 6: Automations repository: drafts, versioned publish, status, stats

**Files:**
- Create: `apps/web/src/lib/data/automations.ts`
- Modify: `apps/web/src/lib/data/types.ts`, `apps/web/src/lib/data/index.ts`, `apps/web/src/lib/data/memory.ts`, `apps/web/src/app/actions.ts`, `apps/web/src/app/(app)/automations/page.tsx`, `apps/web/src/app/(app)/automations/[id]/page.tsx`, `apps/web/src/app/(app)/automations/[id]/editor.tsx`, `apps/web/src/app/(app)/automations/automations-table.tsx`, `apps/web/src/app/(app)/home/page.tsx`
- Modify: `apps/web/test/support.ts`, `apps/web/test/data.test.ts`
- Test: `apps/web/test/automations.test.ts`

**Interfaces:**
- Consumes: `isUuid` (Task 2), `requireWorkspace` / `getCurrentAccount` (Task 5), `compileRecipe` / `DEFAULT_RECIPE` (`lib/recipe.ts`), `FlowDefinitionSchema` / `validateFlow` / `getTemplate` (`@replyooo/shared`).
- Produces:
  ```ts
  // lib/data/types.ts (added)
  type PublishResult = { ok: true; version: number } | { ok: false; errors: string[] }
  type StatusResult = { ok: true } | { ok: false; error: string }
  // lib/data/automations.ts
  const STATS_WINDOW_DAYS = 30
  const DM_KINDS: readonly ['dm', 'private_reply']
  function statsSince(now: Date): Date
  function listAutomations(workspaceId: string, accountId: string, now?: Date): Promise<Automation[]>
  function getAutomation(workspaceId: string, id: string, now?: Date): Promise<Automation | null>
  function createAutomation(workspaceId: string, accountId: string, templateKey: string | null): Promise<Automation | null>
  function saveDraft(workspaceId: string, id: string, input: { name: string; flow: FlowDefinition }): Promise<boolean>
  function publishAutomation(workspaceId: string, id: string): Promise<PublishResult>
  function setAutomationStatus(workspaceId: string, id: string, status: 'active' | 'paused'): Promise<StatusResult>
  function deleteAutomation(workspaceId: string, id: string): Promise<void>
  function keepsPinnedPost(previous: FlowDefinition | null, next: FlowDefinition): boolean
  // test/support.ts (added)
  function createContact(workspaceId, accountId, overrides?): Promise<typeof contacts.$inferSelect>
  function createRun(input: { automationId; contactId; accountId; status?; createdAt? }): Promise<typeof flowRuns.$inferSelect>
  function createMessage(input: { contactId; accountId; runId?; direction?; kind?; status?; body?; createdAt? }): Promise<typeof messages.$inferSelect>
  ```
- Error strings used by later tasks and the UI: `'Automation not found'` and `'Publish this automation first'`.

- [ ] **Step 1: Add seed helpers to the test support file**

Append to `apps/web/test/support.ts` (merge the new names into the existing `@replyooo/db` import, and add `import { eq } from 'drizzle-orm'`):
```ts
import { automations, contacts, flowRuns, messages } from '@replyooo/db'

export async function createContact(
  workspaceId: string,
  accountId: string,
  overrides: Partial<typeof contacts.$inferInsert> = {},
) {
  return one(
    await db()
      .insert(contacts)
      .values({
        workspaceId,
        connectedAccountId: accountId,
        platformUserId: `psid_${randomUUID()}`,
        username: 'priya',
        name: 'Priya Sharma',
        lastInboundAt: new Date(),
        ...overrides,
      })
      .returning(),
  )
}

/** A run of the automation's current (published) version. */
export async function createRun(input: {
  automationId: string
  contactId: string
  accountId: string
  status?: (typeof flowRuns.$inferInsert)['status']
  createdAt?: Date
}) {
  const [automation] = await db()
    .select({ versionId: automations.currentVersionId })
    .from(automations)
    .where(eq(automations.id, input.automationId))
  if (!automation?.versionId) throw new Error('publish the automation before creating runs')
  return one(
    await db()
      .insert(flowRuns)
      .values({
        automationId: input.automationId,
        automationVersionId: automation.versionId,
        contactId: input.contactId,
        connectedAccountId: input.accountId,
        status: input.status ?? 'completed',
        createdAt: input.createdAt ?? new Date(),
      })
      .returning(),
  )
}

export async function createMessage(input: {
  contactId: string
  accountId: string
  runId?: string | null
  direction?: 'in' | 'out'
  kind?: (typeof messages.$inferInsert)['kind']
  status?: (typeof messages.$inferInsert)['status']
  body?: Record<string, unknown>
  createdAt?: Date
}) {
  const direction = input.direction ?? 'out'
  return one(
    await db()
      .insert(messages)
      .values({
        contactId: input.contactId,
        connectedAccountId: input.accountId,
        flowRunId: input.runId ?? null,
        direction,
        kind: input.kind ?? 'dm',
        status: input.status ?? (direction === 'in' ? 'received' : 'sent'),
        body: input.body ?? { type: 'message', message: { text: 'Here you go!' } },
        createdAt: input.createdAt ?? new Date(),
      })
      .returning(),
  )
}
```

- [ ] **Step 2: Write the failing test**

`apps/web/test/automations.test.ts`:
```ts
import { automationVersions, automations } from '@replyooo/db'
import { TEMPLATES, type FlowDefinition } from '@replyooo/shared'
import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as data from '@/lib/data/automations'
import { db } from '@/lib/db'
import { DEFAULT_RECIPE, compileRecipe } from '@/lib/recipe'
import { createAccount, createContact, createMessage, createRun, createWorkspace } from './support'

async function setup(platform: 'instagram' | 'facebook' = 'instagram') {
  const { workspaceId } = await createWorkspace()
  const account = await createAccount(workspaceId, platform)
  return { workspaceId, accountId: account.id }
}

async function created(workspaceId: string, accountId: string, templateKey: string | null) {
  const automation = await data.createAutomation(workspaceId, accountId, templateKey)
  if (!automation) throw new Error('createAutomation returned null')
  return automation
}

// Conversation starters call Meta on publish; they're covered with msw in ice-breakers.test.ts.
const LOCAL_TEMPLATES = TEMPLATES.filter((t) => t.flow.trigger.type !== 'ice_breaker')

describe('publishAutomation', () => {
  it.each(LOCAL_TEMPLATES.map((t) => [t.key] as const))('publishes a fresh %s draft on Instagram', async (key) => {
    const { workspaceId, accountId } = await setup()
    const automation = await created(workspaceId, accountId, key)
    expect(await data.publishAutomation(workspaceId, automation.id)).toEqual({ ok: true, version: 1 })
    expect(await data.getAutomation(workspaceId, automation.id)).toMatchObject({ status: 'active', version: 1 })
    const [version] = await db().select().from(automationVersions).where(eq(automationVersions.automationId, automation.id))
    expect(version?.definition).toEqual(automation.flow)
  })

  it('creates a new immutable version on every publish', async () => {
    const { workspaceId, accountId } = await setup()
    const automation = await created(workspaceId, accountId, 'comment_to_dm')
    await data.publishAutomation(workspaceId, automation.id)

    const edited = structuredClone(automation.flow)
    if (edited.trigger.type === 'comment_keyword') edited.trigger.keywords = ['CHANGED']
    expect(await data.saveDraft(workspaceId, automation.id, { name: 'Renamed', flow: edited })).toBe(true)
    expect(await data.publishAutomation(workspaceId, automation.id)).toEqual({ ok: true, version: 2 })

    const versions = await db()
      .select()
      .from(automationVersions)
      .where(eq(automationVersions.automationId, automation.id))
      .orderBy(asc(automationVersions.version))
    expect(versions.map((v) => v.version)).toEqual([1, 2])
    expect(versions[0]?.definition).toEqual(automation.flow)
    expect(versions[1]?.definition).toEqual(edited)
    const [row] = await db().select().from(automations).where(eq(automations.id, automation.id))
    expect(row?.currentVersionId).toBe(versions[1]?.id)
    expect(row?.name).toBe('Renamed')
  })

  it('rejects a follow gate on a Facebook Page and leaves the draft unpublished', async () => {
    const { workspaceId, accountId } = await setup('facebook')
    const automation = await created(workspaceId, accountId, null)
    await data.saveDraft(workspaceId, automation.id, {
      name: 'Gate',
      flow: compileRecipe({ ...DEFAULT_RECIPE, followGate: { ...DEFAULT_RECIPE.followGate, enabled: true } }),
    })
    expect(await data.publishAutomation(workspaceId, automation.id)).toEqual({
      ok: false,
      errors: ['Follow checks are only available on Instagram'],
    })
    expect(await data.getAutomation(workspaceId, automation.id)).toMatchObject({ status: 'draft', version: 0 })
  })

  it('rejects a comment flow whose first message has no reply button', async () => {
    const { workspaceId, accountId } = await setup()
    const automation = await created(workspaceId, accountId, 'comment_to_dm')
    const flow = structuredClone(automation.flow)
    flow.start = 'link'
    delete flow.steps.opener
    await data.saveDraft(workspaceId, automation.id, { name: 'Broken', flow })
    expect((await data.publishAutomation(workspaceId, automation.id)).ok).toBe(false)
  })
})

describe('"next post" pinning', () => {
  const nextPost = (): FlowDefinition => {
    const flow = compileRecipe(DEFAULT_RECIPE)
    if (flow.trigger.type === 'comment_keyword') flow.trigger.posts = { mode: 'next' }
    return flow
  }

  it('keeps the pinned post when a "next post" automation is republished, and drops it otherwise', async () => {
    const { workspaceId, accountId } = await setup()
    const automation = await created(workspaceId, accountId, null)
    await data.saveDraft(workspaceId, automation.id, { name: 'Next', flow: nextPost() })
    await data.publishAutomation(workspaceId, automation.id)
    await db().update(automations).set({ pinnedMediaId: 'media_1' }).where(eq(automations.id, automation.id))

    await data.publishAutomation(workspaceId, automation.id)
    let [row] = await db().select().from(automations).where(eq(automations.id, automation.id))
    expect(row?.pinnedMediaId).toBe('media_1')

    await data.saveDraft(workspaceId, automation.id, { name: 'Any', flow: compileRecipe(DEFAULT_RECIPE) })
    await data.publishAutomation(workspaceId, automation.id)
    ;[row] = await db().select().from(automations).where(eq(automations.id, automation.id))
    expect(row?.pinnedMediaId).toBeNull()
  })

  it('only keeps a pin between two "next post" versions', () => {
    expect(data.keepsPinnedPost(nextPost(), nextPost())).toBe(true)
    expect(data.keepsPinnedPost(null, nextPost())).toBe(false)
    expect(data.keepsPinnedPost(compileRecipe(DEFAULT_RECIPE), nextPost())).toBe(false)
  })
})

describe('workspace isolation', () => {
  it('treats another workspace’s automation as missing', async () => {
    const a = await setup()
    const b = await setup()
    const automation = await created(a.workspaceId, a.accountId, 'comment_to_dm')

    expect(await data.getAutomation(b.workspaceId, automation.id)).toBeNull()
    expect(await data.saveDraft(b.workspaceId, automation.id, { name: 'Hijacked', flow: automation.flow })).toBe(false)
    expect(await data.publishAutomation(b.workspaceId, automation.id)).toEqual({ ok: false, errors: ['Automation not found'] })
    expect(await data.setAutomationStatus(b.workspaceId, automation.id, 'paused')).toEqual({
      ok: false,
      error: 'Automation not found',
    })
    await data.deleteAutomation(b.workspaceId, automation.id)
    expect(await data.listAutomations(b.workspaceId, a.accountId)).toEqual([])

    expect(await data.getAutomation(a.workspaceId, automation.id)).toMatchObject({ name: automation.name, status: 'draft' })
  })

  it('won’t create an automation on another workspace’s account', async () => {
    const a = await setup()
    const b = await setup()
    expect(await data.createAutomation(b.workspaceId, a.accountId, null)).toBeNull()
  })

  it('returns not found for malformed ids instead of throwing', async () => {
    const { workspaceId, accountId } = await setup()
    expect(await data.getAutomation(workspaceId, 'aut_breakfast')).toBeNull()
    expect(await data.saveDraft(workspaceId, 'aut_breakfast', { name: 'x', flow: compileRecipe(DEFAULT_RECIPE) })).toBe(false)
    expect(await data.publishAutomation(workspaceId, 'aut_breakfast')).toEqual({ ok: false, errors: ['Automation not found'] })
    expect(await data.setAutomationStatus(workspaceId, 'aut_breakfast', 'paused')).toEqual({ ok: false, error: 'Automation not found' })
    expect(await data.createAutomation(workspaceId, 'acc_ig', null)).toBeNull()
    expect(await data.listAutomations(workspaceId, 'acc_ig')).toEqual([])
    await expect(data.deleteAutomation(workspaceId, 'aut_breakfast')).resolves.toBeUndefined()
    expect(await data.listAutomations(workspaceId, accountId)).toEqual([])
  })
})

describe('setAutomationStatus', () => {
  it('cannot turn on an automation that was never published', async () => {
    const { workspaceId, accountId } = await setup()
    const automation = await created(workspaceId, accountId, null)
    expect(await data.setAutomationStatus(workspaceId, automation.id, 'active')).toEqual({
      ok: false,
      error: 'Publish this automation first',
    })
    expect((await data.getAutomation(workspaceId, automation.id))?.status).toBe('draft')
  })

  it('pauses and resumes a published automation', async () => {
    const { workspaceId, accountId } = await setup()
    const automation = await created(workspaceId, accountId, 'dm_keyword')
    await data.publishAutomation(workspaceId, automation.id)
    expect(await data.setAutomationStatus(workspaceId, automation.id, 'paused')).toEqual({ ok: true })
    expect((await data.getAutomation(workspaceId, automation.id))?.status).toBe('paused')
    expect(await data.setAutomationStatus(workspaceId, automation.id, 'active')).toEqual({ ok: true })
    expect((await data.getAutomation(workspaceId, automation.id))?.status).toBe('active')
  })
})

describe('listAutomations', () => {
  it('counts runs, completions, DMs sent and leads from the last 30 days', async () => {
    const { workspaceId, accountId } = await setup()
    const automation = await created(workspaceId, accountId, 'comment_to_dm')
    await data.publishAutomation(workspaceId, automation.id)
    const lead = await createContact(workspaceId, accountId, { email: 'lead@example.com' })
    const other = await createContact(workspaceId, accountId)

    const run = await createRun({ automationId: automation.id, contactId: lead.id, accountId, status: 'completed' })
    await createRun({ automationId: automation.id, contactId: other.id, accountId, status: 'failed' })
    await createRun({
      automationId: automation.id,
      contactId: other.id,
      accountId,
      status: 'completed',
      createdAt: new Date(Date.now() - 40 * 86_400_000),
    })
    await createMessage({ contactId: lead.id, accountId, runId: run.id, kind: 'private_reply' })
    await createMessage({ contactId: lead.id, accountId, runId: run.id, kind: 'dm' })
    await createMessage({ contactId: lead.id, accountId, runId: run.id, kind: 'dm', status: 'failed' })
    await createMessage({ contactId: lead.id, accountId, runId: run.id, kind: 'comment_reply', body: { type: 'comment', text: 'Sent!' } })

    const [listed] = await data.listAutomations(workspaceId, accountId)
    expect(listed?.stats).toEqual({ runs: 2, completed: 1, dmsSent: 2, leads: 1 })
  })

  it('lists live automations before paused ones and drafts', async () => {
    const { workspaceId, accountId } = await setup()
    const draft = await created(workspaceId, accountId, null)
    const live = await created(workspaceId, accountId, 'dm_keyword')
    await data.publishAutomation(workspaceId, live.id)
    expect((await data.listAutomations(workspaceId, accountId)).map((a) => a.id)).toEqual([live.id, draft.id])
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @replyooo/web test automations`
Expected: FAIL. `@/lib/data/automations` can't be resolved.

- [ ] **Step 4: Implement the repository**

Append to `apps/web/src/lib/data/types.ts`:
```ts
export type PublishResult = { ok: true; version: number } | { ok: false; errors: string[] }
export type StatusResult = { ok: true } | { ok: false; error: string }
```

`apps/web/src/lib/data/automations.ts`:
```ts
import 'server-only'
import { automationVersions, automations, connectedAccounts, contacts, flowRuns, messages } from '@replyooo/db'
import { FlowDefinitionSchema, getTemplate, validateFlow, type FlowDefinition } from '@replyooo/shared'
import { and, eq, gte, inArray, max, type SQL, sql } from 'drizzle-orm'
import { db } from '../db'
import { DEFAULT_RECIPE, compileRecipe } from '../recipe'
import { isUuid } from './ids'
import type { Automation, AutomationStats, AutomationStatus, PublishResult, StatusResult } from './types'

export const STATS_WINDOW_DAYS = 30
export const DM_KINDS = ['dm', 'private_reply'] as const
const NOT_FOUND = 'Automation not found'
const EMPTY_STATS: AutomationStats = { runs: 0, completed: 0, dmsSent: 0, leads: 0 }

export function statsSince(now: Date): Date {
  return new Date(now.getTime() - STATS_WINDOW_DAYS * 86_400_000)
}

const columns = {
  id: automations.id,
  accountId: automations.connectedAccountId,
  name: automations.name,
  status: automations.status,
  flow: automations.definition,
  templateKey: automations.templateKey,
  updatedAt: automations.updatedAt,
  version: automationVersions.version,
  publishedAt: automationVersions.publishedAt,
}

function selectAutomations(where: SQL | undefined) {
  return db()
    .select(columns)
    .from(automations)
    .leftJoin(automationVersions, eq(automationVersions.id, automations.currentVersionId))
    .where(where)
}

type AutomationRow = Awaited<ReturnType<typeof selectAutomations>>[number]

function toAutomation(row: AutomationRow, stats: AutomationStats | undefined): Automation {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    status: row.status,
    flow: row.flow,
    version: row.version ?? 0,
    templateKey: row.templateKey,
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    stats: stats ?? EMPTY_STATS,
  }
}

const statusRank = (status: AutomationStatus) => ({ active: 0, paused: 1, draft: 2 })[status]

async function automationStats(ids: string[], since: Date): Promise<Map<string, AutomationStats>> {
  const stats = new Map<string, AutomationStats>()
  if (ids.length === 0) return stats

  const runRows = await db()
    .select({
      automationId: flowRuns.automationId,
      runs: sql<number>`count(*)`.mapWith(Number),
      completed: sql<number>`count(*) filter (where ${flowRuns.status} = 'completed')`.mapWith(Number),
      leads: sql<number>`count(distinct ${flowRuns.contactId}) filter (where ${contacts.email} is not null or ${contacts.phone} is not null)`.mapWith(
        Number,
      ),
    })
    .from(flowRuns)
    .innerJoin(contacts, eq(contacts.id, flowRuns.contactId))
    .where(and(inArray(flowRuns.automationId, ids), gte(flowRuns.createdAt, since)))
    .groupBy(flowRuns.automationId)

  const sentRows = await db()
    .select({ automationId: flowRuns.automationId, dmsSent: sql<number>`count(*)`.mapWith(Number) })
    .from(messages)
    .innerJoin(flowRuns, eq(flowRuns.id, messages.flowRunId))
    .where(
      and(
        inArray(flowRuns.automationId, ids),
        eq(messages.direction, 'out'),
        eq(messages.status, 'sent'),
        inArray(messages.kind, [...DM_KINDS]),
        gte(messages.createdAt, since),
      ),
    )
    .groupBy(flowRuns.automationId)

  for (const row of runRows) {
    stats.set(row.automationId, { runs: row.runs, completed: row.completed, leads: row.leads, dmsSent: 0 })
  }
  for (const row of sentRows) {
    stats.set(row.automationId, { ...(stats.get(row.automationId) ?? EMPTY_STATS), dmsSent: row.dmsSent })
  }
  return stats
}

export async function listAutomations(workspaceId: string, accountId: string, now = new Date()): Promise<Automation[]> {
  if (!isUuid(accountId)) return []
  const rows = await selectAutomations(
    and(eq(automations.workspaceId, workspaceId), eq(automations.connectedAccountId, accountId)),
  )
  const stats = await automationStats(
    rows.map((row) => row.id),
    statsSince(now),
  )
  return rows
    .map((row) => toAutomation(row, stats.get(row.id)))
    .sort(
      (a, b) =>
        statusRank(a.status) - statusRank(b.status) || b.stats.runs - a.stats.runs || b.updatedAt.localeCompare(a.updatedAt),
    )
}

export async function getAutomation(workspaceId: string, id: string, now = new Date()): Promise<Automation | null> {
  if (!isUuid(id)) return null
  const [row] = await selectAutomations(and(eq(automations.workspaceId, workspaceId), eq(automations.id, id)))
  if (!row) return null
  const stats = await automationStats([row.id], statsSince(now))
  return toAutomation(row, stats.get(row.id))
}

export async function createAutomation(
  workspaceId: string,
  accountId: string,
  templateKey: string | null,
): Promise<Automation | null> {
  if (!isUuid(accountId)) return null
  const [account] = await db()
    .select({ id: connectedAccounts.id })
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.workspaceId, workspaceId), eq(connectedAccounts.id, accountId)))
  if (!account) return null

  const template = templateKey ? getTemplate(templateKey) : undefined
  const flow = template ? structuredClone(template.flow) : compileRecipe(DEFAULT_RECIPE)
  const [row] = await db()
    .insert(automations)
    .values({
      workspaceId,
      connectedAccountId: accountId,
      name: template?.title ?? 'Untitled automation',
      triggerType: flow.trigger.type,
      definition: flow,
      templateKey: template?.key ?? null,
    })
    .returning({ id: automations.id })
  return row ? getAutomation(workspaceId, row.id) : null
}

/** Drafts may be incomplete; callers have already checked they're a well-formed FlowDefinition. */
export async function saveDraft(
  workspaceId: string,
  id: string,
  input: { name: string; flow: FlowDefinition },
): Promise<boolean> {
  if (!isUuid(id)) return false
  const updated = await db()
    .update(automations)
    .set({ name: input.name.trim() || 'Untitled automation', definition: input.flow, triggerType: input.flow.trigger.type })
    .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, id)))
    .returning({ id: automations.id })
  return updated.length > 0
}

/** A "next post" comment trigger stays on the post it already latched onto when republished. */
export function keepsPinnedPost(previous: FlowDefinition | null, next: FlowDefinition): boolean {
  const isNextPost = (flow: FlowDefinition | null) =>
    flow?.trigger.type === 'comment_keyword' && flow.trigger.posts.mode === 'next'
  return isNextPost(previous) && isNextPost(next)
}

/** Spec §5.4: validate server-side, write an immutable version, point the automation at it. */
export async function publishAutomation(workspaceId: string, id: string): Promise<PublishResult> {
  if (!isUuid(id)) return { ok: false, errors: [NOT_FOUND] }
  return db().transaction(async (tx): Promise<PublishResult> => {
    const [current] = await tx
      .select({ automation: automations, platform: connectedAccounts.platform, live: automationVersions.definition })
      .from(automations)
      .innerJoin(connectedAccounts, eq(connectedAccounts.id, automations.connectedAccountId))
      .leftJoin(automationVersions, eq(automationVersions.id, automations.currentVersionId))
      .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, id)))
      .for('update', { of: automations })
    if (!current) return { ok: false, errors: [NOT_FOUND] }

    const parsed = FlowDefinitionSchema.safeParse(current.automation.definition)
    if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) }
    const issues = validateFlow(parsed.data, current.platform)
    if (issues.length > 0) return { ok: false, errors: issues.map((issue) => issue.message) }
    const flow = parsed.data

    const [latest] = await tx
      .select({ version: max(automationVersions.version) })
      .from(automationVersions)
      .where(eq(automationVersions.automationId, id))
    const version = (latest?.version ?? 0) + 1
    const [created] = await tx
      .insert(automationVersions)
      .values({ automationId: id, version, definition: flow })
      .returning({ id: automationVersions.id })
    if (!created) throw new Error('version insert returned nothing')

    await tx
      .update(automations)
      .set({
        currentVersionId: created.id,
        status: 'active',
        triggerType: flow.trigger.type,
        pinnedMediaId: keepsPinnedPost(current.live, flow) ? current.automation.pinnedMediaId : null,
      })
      .where(eq(automations.id, id))
    return { ok: true, version }
  })
}

export async function setAutomationStatus(
  workspaceId: string,
  id: string,
  status: 'active' | 'paused',
): Promise<StatusResult> {
  if (!isUuid(id)) return { ok: false, error: NOT_FOUND }
  const [row] = await db()
    .select({ versionId: automations.currentVersionId })
    .from(automations)
    .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, id)))
  if (!row) return { ok: false, error: NOT_FOUND }
  if (!row.versionId) return { ok: false, error: 'Publish this automation first' }
  await db().update(automations).set({ status }).where(eq(automations.id, id))
  return { ok: true }
}

/** Cascades to versions and runs; in-flight conversations stop. */
export async function deleteAutomation(workspaceId: string, id: string): Promise<void> {
  if (!isUuid(id)) return
  await db().delete(automations).where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, id)))
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @replyooo/web test automations`
Expected: PASS.

- [ ] **Step 6: Remove the in-memory automations and rewire the pages**

In `apps/web/src/lib/data/memory.ts`, delete `listAutomations`, `statusRank`, `getAutomation`, `createAutomation`, `saveDraft`, `PublishResult`, `publishAutomation`, `setAutomationStatus` and `deleteAutomation`, then delete any imports that are now unused (`FlowDefinitionSchema`, `getTemplate`, `validateFlow`, `FlowDefinition`, `DEFAULT_RECIPE`, `compileRecipe`, `AutomationStatus`). Leave `getHomeStats` and the contact/workspace functions; they still read `store.automations` from the seed.

In `apps/web/src/lib/data/index.ts`, add `export * from './automations'` after the accounts line.

In `apps/web/test/data.test.ts`, delete the whole `describe('publishAutomation', …)` block and the imports only it used (`TEMPLATES`, `DEFAULT_RECIPE`, `compileRecipe`). The publish cases now live in `automations.test.ts`.

In `apps/web/src/app/actions.ts`, replace `createAutomation`, `saveDraft`, `publishAutomation`, `setAutomationStatus` and `deleteAutomation` with:
```ts
export async function createAutomation(templateKey: string | null) {
  const { workspace, account } = await getCurrentAccount()
  const automation = await data.createAutomation(workspace.workspaceId, account.id, templateKey)
  if (!automation) redirect('/connect')
  redirect(`/automations/${automation.id}`)
}

export async function saveDraft(id: string, name: string, flow: unknown) {
  const { workspaceId } = await requireWorkspace()
  // Drafts may be incomplete, but they must still be well-formed JSON of the right shape.
  const parsed = FlowDefinitionSchema.safeParse(flow)
  if (!parsed.success) return { ok: false as const, error: 'Fix the highlighted fields before saving' }
  if (!(await data.saveDraft(workspaceId, id, { name, flow: parsed.data }))) {
    return { ok: false as const, error: 'This automation no longer exists' }
  }
  revalidatePath('/automations')
  return { ok: true as const, savedAt: new Date().toISOString() }
}

export async function publishAutomation(id: string, name: string, flow: unknown): Promise<data.PublishResult> {
  const saved = await saveDraft(id, name, flow)
  if (!saved.ok) return { ok: false, errors: [saved.error] }
  const { workspaceId } = await requireWorkspace()
  const result = await data.publishAutomation(workspaceId, id)
  revalidatePath('/automations')
  revalidatePath(`/automations/${id}`)
  return result
}

export async function setAutomationStatus(id: string, status: 'active' | 'paused'): Promise<data.StatusResult> {
  const { workspaceId } = await requireWorkspace()
  const result = await data.setAutomationStatus(workspaceId, id, status)
  revalidatePath('/automations')
  return result
}

export async function deleteAutomation(id: string) {
  const { workspaceId } = await requireWorkspace()
  await data.deleteAutomation(workspaceId, id)
  revalidatePath('/automations')
}
```

In `apps/web/src/app/(app)/automations/[id]/page.tsx`, fetch the workspace before the automation:
```tsx
export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { workspaceId } = await requireWorkspace()
  const automation = await getAutomation(workspaceId, id)
  if (!automation) notFound()
  const account = await getAccount(workspaceId, automation.accountId)
  if (!account) notFound()

  return <Editor key={automation.id} automation={automation} platform={account.platform} username={account.username} />
}
```

In `apps/web/src/app/(app)/automations/page.tsx`, change the first two lines of the component to:
```tsx
  const { workspace, account } = await getCurrentAccount()
  const [automations, stats] = await Promise.all([listAutomations(workspace.workspaceId, account.id), getHomeStats(account.id)])
```
(`getHomeStats` is still the in-memory one; Task 8 replaces it.)

In `apps/web/src/app/(app)/home/page.tsx`, change `const { account } = await getCurrentAccount()` to `const { workspace: ctx, account } = await getCurrentAccount()`, and change `listAutomations(account.id)` to `listAutomations(ctx.workspaceId, account.id)`.

In `apps/web/src/app/(app)/automations/[id]/editor.tsx`, replace `toggleLive` so a refused resume rolls back and shows the reason:
```tsx
  const toggleLive = () => {
    const previous = status
    const next = status === 'active' ? 'paused' : 'active'
    setStatus(next)
    startStatus(async () => {
      const result = await setAutomationStatus(automation.id, next)
      if (!result.ok) {
        setStatus(previous)
        setPublishErrors([result.error])
      }
    })
  }
```

In `apps/web/src/app/(app)/automations/automations-table.tsx`:
- add `import type { StatusResult } from '@/lib/data/types'`
- replace `run` with:
```tsx
  const run = (action: () => Promise<StatusResult | void>) => {
    setOpen(false)
    startTransition(async () => {
      const result = await action()
      if (result && !result.ok) alert(result.error)
    })
  }
```

- [ ] **Step 7: Verify**

Run: `pnpm --filter @replyooo/web typecheck && pnpm --filter @replyooo/web test`
Expected: clean typecheck, all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add -A apps/web/src apps/web/test
git commit -m "feat(web): store automations in Postgres with versioned publish"
```

---

### Task 7: Conversation starters: push to Meta on publish, pause, resume and delete

**Files:**
- Create: `apps/web/src/lib/meta.ts`, `apps/web/src/lib/data/ice-breakers.ts`
- Modify: `apps/web/src/lib/data/automations.ts`
- Test: `apps/web/test/ice-breakers.test.ts`

**Interfaces:**
- Consumes: `createInstagramAdapter`, `createFacebookAdapter`, `MetaError`, `IceBreaker`, `AccountCredentials` (`@replyooo/meta`); `encodePostback` (`@replyooo/shared`); `decryptToken`, `parseEncryptionKey` (`@replyooo/db`); Task 6's `publishAutomation` / `setAutomationStatus` / `deleteAutomation`.
- Produces:
  ```ts
  // lib/meta.ts
  function adapterFor(platform: Platform): PlatformAdapter
  function tokenKey(): Buffer
  function credentialsFor(account: { externalId: string; accessTokenEnc: string }): AccountCredentials
  // lib/data/ice-breakers.ts
  function iceBreakerItems(automationId: string, flow: FlowDefinition | null): IceBreaker[]   // [] unless ice_breaker
  function pushIceBreakers(account: { platform; externalId; accessTokenEnc }, items: IceBreaker[]): Promise<void>
  function iceBreakerError(error: MetaError, username: string): string
  ```
- Behaviour: see Global Constraints ("Conversation starters"). The publish and resume pushes happen **inside** the DB transaction, so a Meta error rolls them back. A `reauth` error also sets the account to `reauth_required` after the rollback. Pause and delete clear the starters on a best-effort basis after the DB change, and log failures with `console.warn`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/ice-breakers.test.ts`:
```ts
import { automationVersions, automations, connectedAccounts } from '@replyooo/db'
import { encodePostback } from '@replyooo/shared'
import { eq } from 'drizzle-orm'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as data from '@/lib/data/automations'
import { iceBreakerItems } from '@/lib/data/ice-breakers'
import { db } from '@/lib/db'
import { DEFAULT_RECIPE, compileRecipe } from '@/lib/recipe'
import { createAccount, createWorkspace } from './support'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const IG = 'https://graph.instagram.com/v24.0'

function messengerProfile(externalId: string, response: { status?: number; body?: unknown } = {}) {
  const calls: { method: string; body: unknown }[] = []
  server.use(
    http.all(`${IG}/${externalId}/messenger_profile`, async ({ request }) => {
      calls.push({ method: request.method, body: await request.json() })
      return HttpResponse.json(response.body ?? { result: 'success' }, { status: response.status ?? 200 })
    }),
  )
  return calls
}

async function setup() {
  const { workspaceId } = await createWorkspace()
  const account = await createAccount(workspaceId, 'instagram')
  return { workspaceId, account }
}

async function starters(workspaceId: string, accountId: string) {
  const automation = await data.createAutomation(workspaceId, accountId, 'conversation_starters')
  if (!automation) throw new Error('createAutomation returned null')
  return automation
}

describe('iceBreakerItems', () => {
  it('maps each question to an ice-breaker postback and ignores other triggers', () => {
    const flow = compileRecipe({
      ...DEFAULT_RECIPE,
      trigger: { type: 'ice_breaker', items: [{ question: 'Prices?', answer: 'From $9' }, { question: 'Hours?', answer: '9–5' }] },
    })
    expect(iceBreakerItems('aut-1', flow)).toEqual([
      { question: 'Prices?', payload: encodePostback({ kind: 'ice_breaker', automationId: 'aut-1', itemIndex: 0 }) },
      { question: 'Hours?', payload: encodePostback({ kind: 'ice_breaker', automationId: 'aut-1', itemIndex: 1 }) },
    ])
    expect(iceBreakerItems('aut-1', compileRecipe(DEFAULT_RECIPE))).toEqual([])
    expect(iceBreakerItems('aut-1', null)).toEqual([])
  })
})

describe('publishing conversation starters', () => {
  it('pushes the questions to Meta with ice-breaker postbacks', async () => {
    const { workspaceId, account } = await setup()
    const calls = messengerProfile(account.externalId)
    const automation = await starters(workspaceId, account.id)

    expect(await data.publishAutomation(workspaceId, automation.id)).toEqual({ ok: true, version: 1 })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      method: 'POST',
      body: {
        platform: 'instagram',
        ice_breakers: [{ locale: 'default', call_to_actions: iceBreakerItems(automation.id, automation.flow) }],
      },
    })
  })

  it('publishing a second conversation starter pauses the first', async () => {
    const { workspaceId, account } = await setup()
    messengerProfile(account.externalId)
    const first = await starters(workspaceId, account.id)
    const second = await starters(workspaceId, account.id)
    await data.publishAutomation(workspaceId, first.id)
    await data.publishAutomation(workspaceId, second.id)

    expect((await data.getAutomation(workspaceId, first.id))?.status).toBe('paused')
    expect((await data.getAutomation(workspaceId, second.id))?.status).toBe('active')
  })

  it('a Meta rejection rolls the publish back and flags a revoked token', async () => {
    const { workspaceId, account } = await setup()
    messengerProfile(account.externalId, {
      status: 400,
      body: { error: { message: 'Error validating access token', code: 190 } },
    })
    const automation = await starters(workspaceId, account.id)

    const result = await data.publishAutomation(workspaceId, automation.id)
    expect(result).toEqual({
      ok: false,
      errors: [`Meta revoked access to @${account.username}. Reconnect it in Settings, then publish again.`],
    })
    expect(await data.getAutomation(workspaceId, automation.id)).toMatchObject({ status: 'draft', version: 0 })
    expect(await db().select().from(automationVersions).where(eq(automationVersions.automationId, automation.id))).toEqual([])
    const [row] = await db().select().from(connectedAccounts).where(eq(connectedAccounts.id, account.id))
    expect(row?.status).toBe('reauth_required')
  })

  it('clears the questions when the automation is republished with another trigger', async () => {
    const { workspaceId, account } = await setup()
    const calls = messengerProfile(account.externalId)
    const automation = await starters(workspaceId, account.id)
    await data.publishAutomation(workspaceId, automation.id)
    await data.saveDraft(workspaceId, automation.id, {
      name: 'Now a keyword',
      flow: compileRecipe({ ...DEFAULT_RECIPE, opener: { ...DEFAULT_RECIPE.opener, enabled: false }, trigger: { type: 'dm_keyword', keywords: ['HI'], match: 'contains' } }),
    })
    await data.publishAutomation(workspaceId, automation.id)

    expect(calls.map((c) => c.method)).toEqual(['POST', 'DELETE'])
    expect(calls[1]?.body).toEqual({ platform: 'instagram', fields: ['ice_breakers'] })
  })
})

describe('pausing, resuming and deleting conversation starters', () => {
  it('pausing clears the questions and resuming pushes them again', async () => {
    const { workspaceId, account } = await setup()
    const calls = messengerProfile(account.externalId)
    const automation = await starters(workspaceId, account.id)
    await data.publishAutomation(workspaceId, automation.id)

    expect(await data.setAutomationStatus(workspaceId, automation.id, 'paused')).toEqual({ ok: true })
    expect(await data.setAutomationStatus(workspaceId, automation.id, 'active')).toEqual({ ok: true })
    expect(calls.map((c) => c.method)).toEqual(['POST', 'DELETE', 'POST'])
  })

  it('a refused resume stays paused', async () => {
    const { workspaceId, account } = await setup()
    messengerProfile(account.externalId)
    const automation = await starters(workspaceId, account.id)
    await data.publishAutomation(workspaceId, automation.id)
    await data.setAutomationStatus(workspaceId, automation.id, 'paused')

    server.resetHandlers()
    messengerProfile(account.externalId, { status: 500, body: { error: { message: 'Temporarily unavailable', code: 2 } } })
    const result = await data.setAutomationStatus(workspaceId, automation.id, 'active')
    expect(result.ok).toBe(false)
    expect((await data.getAutomation(workspaceId, automation.id))?.status).toBe('paused')
  })

  it('deleting the live conversation starter clears the questions', async () => {
    const { workspaceId, account } = await setup()
    const calls = messengerProfile(account.externalId)
    const automation = await starters(workspaceId, account.id)
    await data.publishAutomation(workspaceId, automation.id)
    await data.deleteAutomation(workspaceId, automation.id)

    expect(calls.map((c) => c.method)).toEqual(['POST', 'DELETE'])
    expect(await db().select().from(automations).where(eq(automations.id, automation.id))).toEqual([])
  })

  it('pausing still succeeds when Meta is down', async () => {
    const { workspaceId, account } = await setup()
    messengerProfile(account.externalId)
    const automation = await starters(workspaceId, account.id)
    await data.publishAutomation(workspaceId, automation.id)

    server.resetHandlers()
    messengerProfile(account.externalId, { status: 500, body: { error: { message: 'down', code: 2 } } })
    expect(await data.setAutomationStatus(workspaceId, automation.id, 'paused')).toEqual({ ok: true })
    expect((await data.getAutomation(workspaceId, automation.id))?.status).toBe('paused')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @replyooo/web test ice-breakers`
Expected: FAIL. `@/lib/data/ice-breakers` can't be resolved.

- [ ] **Step 3: Add the Meta helpers**

`apps/web/src/lib/meta.ts`:
```ts
import 'server-only'
import { decryptToken, parseEncryptionKey } from '@replyooo/db'
import {
  type AccountCredentials,
  createFacebookAdapter,
  createInstagramAdapter,
  type PlatformAdapter,
} from '@replyooo/meta'
import type { Platform } from '@replyooo/shared'
import { env } from './env'

export function adapterFor(platform: Platform): PlatformAdapter {
  const options = { graphVersion: env().META_GRAPH_VERSION }
  return platform === 'instagram' ? createInstagramAdapter(options) : createFacebookAdapter(options)
}

export function tokenKey(): Buffer {
  return parseEncryptionKey(env().TOKEN_ENCRYPTION_KEY)
}

export function credentialsFor(account: { externalId: string; accessTokenEnc: string }): AccountCredentials {
  return { externalId: account.externalId, accessToken: decryptToken(account.accessTokenEnc, tokenKey()) }
}
```

`apps/web/src/lib/data/ice-breakers.ts`:
```ts
import 'server-only'
import type { IceBreaker, MetaError } from '@replyooo/meta'
import { encodePostback, type FlowDefinition, type Platform } from '@replyooo/shared'
import { adapterFor, credentialsFor } from '../meta'

/** The questions Meta shows, each pointing back at this automation's item (spec §2.4 ice-breaker postbacks). */
export function iceBreakerItems(automationId: string, flow: FlowDefinition | null): IceBreaker[] {
  if (flow?.trigger.type !== 'ice_breaker') return []
  return flow.trigger.items.map((item, itemIndex) => ({
    question: item.question,
    payload: encodePostback({ kind: 'ice_breaker', automationId, itemIndex }),
  }))
}

/** An empty list clears the account's conversation starters. */
export async function pushIceBreakers(
  account: { platform: Platform; externalId: string; accessTokenEnc: string },
  items: IceBreaker[],
): Promise<void> {
  await adapterFor(account.platform).setIceBreakers(credentialsFor(account), items)
}

export function iceBreakerError(error: MetaError, username: string): string {
  if (error.kind === 'reauth') return `Meta revoked access to @${username}. Reconnect it in Settings, then publish again.`
  return `Meta didn’t accept the conversation starters: ${error.message}`
}
```

- [ ] **Step 4: Sync conversation starters from publish, status changes and delete**

In `apps/web/src/lib/data/automations.ts`:

Add imports:
```ts
import { MetaError } from '@replyooo/meta'
import { ne } from 'drizzle-orm'   // merge into the existing drizzle-orm import
import { iceBreakerError, iceBreakerItems, pushIceBreakers } from './ice-breakers'
```
and add `type Tx` to the `@replyooo/db` import.

Add these helpers above `publishAutomation`:
```ts
type AccountRow = typeof connectedAccounts.$inferSelect

/** Other live automations on the account whose published trigger is ice_breaker → paused. */
async function pauseOtherIceBreakers(tx: Tx, accountId: string, keepId: string): Promise<void> {
  const live = tx
    .select({ id: automations.id })
    .from(automations)
    .innerJoin(automationVersions, eq(automationVersions.id, automations.currentVersionId))
    .where(
      and(
        eq(automations.connectedAccountId, accountId),
        eq(automations.status, 'active'),
        ne(automations.id, keepId),
        sql`${automationVersions.definition}->'trigger'->>'type' = 'ice_breaker'`,
      ),
    )
  await tx.update(automations).set({ status: 'paused' }).where(inArray(automations.id, live))
}

async function markReauthRequired(accountId: string): Promise<void> {
  await db().update(connectedAccounts).set({ status: 'reauth_required' }).where(eq(connectedAccounts.id, accountId))
}

/** Meta errors from a push inside a transaction become a user-facing message after the rollback. */
async function metaFailure(error: unknown, account: AccountRow | undefined): Promise<string> {
  if (!(error instanceof MetaError) || !account) throw error
  if (error.kind === 'reauth') await markReauthRequired(account.id)
  return iceBreakerError(error, account.username)
}

async function clearIceBreakersQuietly(account: AccountRow): Promise<void> {
  try {
    await pushIceBreakers(account, [])
  } catch (error) {
    // The worker ignores postbacks for automations that aren't live, so stale questions are harmless.
    console.warn('clearing conversation starters failed', { accountId: account.id, error })
  }
}
```

Replace `publishAutomation`, `setAutomationStatus` and `deleteAutomation` with:
```ts
/**
 * Spec §5.4: validate server-side, write an immutable version, point the automation at it,
 * and (for conversation starters) push the questions to Meta before committing.
 */
export async function publishAutomation(workspaceId: string, id: string): Promise<PublishResult> {
  if (!isUuid(id)) return { ok: false, errors: [NOT_FOUND] }
  // Set inside the transaction callback; an object so TypeScript doesn't narrow it to undefined.
  const state: { account?: AccountRow } = {}
  try {
    return await db().transaction(async (tx): Promise<PublishResult> => {
      const [current] = await tx
        .select({ automation: automations, account: connectedAccounts, live: automationVersions.definition })
        .from(automations)
        .innerJoin(connectedAccounts, eq(connectedAccounts.id, automations.connectedAccountId))
        .leftJoin(automationVersions, eq(automationVersions.id, automations.currentVersionId))
        .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, id)))
        .for('update', { of: automations })
      if (!current) return { ok: false, errors: [NOT_FOUND] }
      state.account = current.account

      const parsed = FlowDefinitionSchema.safeParse(current.automation.definition)
      if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) }
      const issues = validateFlow(parsed.data, current.account.platform)
      if (issues.length > 0) return { ok: false, errors: issues.map((issue) => issue.message) }
      const flow = parsed.data

      const [latest] = await tx
        .select({ version: max(automationVersions.version) })
        .from(automationVersions)
        .where(eq(automationVersions.automationId, id))
      const version = (latest?.version ?? 0) + 1
      const [created] = await tx
        .insert(automationVersions)
        .values({ automationId: id, version, definition: flow })
        .returning({ id: automationVersions.id })
      if (!created) throw new Error('version insert returned nothing')

      await tx
        .update(automations)
        .set({
          currentVersionId: created.id,
          status: 'active',
          triggerType: flow.trigger.type,
          pinnedMediaId: keepsPinnedPost(current.live, flow) ? current.automation.pinnedMediaId : null,
        })
        .where(eq(automations.id, id))

      const items = iceBreakerItems(id, flow)
      const wasLiveIceBreaker = current.automation.status === 'active' && iceBreakerItems(id, current.live).length > 0
      if (items.length > 0) {
        await pauseOtherIceBreakers(tx, current.account.id, id)
        await pushIceBreakers(current.account, items)
      } else if (wasLiveIceBreaker) {
        await pushIceBreakers(current.account, [])
      }
      return { ok: true, version }
    })
  } catch (error) {
    return { ok: false, errors: [await metaFailure(error, state.account)] }
  }
}

export async function setAutomationStatus(
  workspaceId: string,
  id: string,
  status: 'active' | 'paused',
): Promise<StatusResult> {
  if (!isUuid(id)) return { ok: false, error: NOT_FOUND }
  const state: { account?: AccountRow; clearAfter: boolean } = { clearAfter: false }
  try {
    const result = await db().transaction(async (tx): Promise<StatusResult> => {
      const [row] = await tx
        .select({ automation: automations, account: connectedAccounts, live: automationVersions.definition })
        .from(automations)
        .innerJoin(connectedAccounts, eq(connectedAccounts.id, automations.connectedAccountId))
        .leftJoin(automationVersions, eq(automationVersions.id, automations.currentVersionId))
        .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, id)))
        .for('update', { of: automations })
      if (!row) return { ok: false, error: NOT_FOUND }
      if (!row.automation.currentVersionId) return { ok: false, error: 'Publish this automation first' }
      state.account = row.account
      if (row.automation.status === status) return { ok: true }

      const items = iceBreakerItems(id, row.live)
      if (items.length > 0 && status === 'active') {
        await pauseOtherIceBreakers(tx, row.account.id, id)
        await pushIceBreakers(row.account, items)
      }
      state.clearAfter = items.length > 0 && status === 'paused'
      await tx.update(automations).set({ status }).where(eq(automations.id, id))
      return { ok: true }
    })
    if (state.clearAfter && state.account) await clearIceBreakersQuietly(state.account)
    return result
  } catch (error) {
    return { ok: false, error: await metaFailure(error, state.account) }
  }
}

/** Cascades to versions and runs; in-flight conversations stop. Reads the live version before the cascade removes it. */
export async function deleteAutomation(workspaceId: string, id: string): Promise<void> {
  if (!isUuid(id)) return
  const [row] = await db()
    .select({ automation: automations, account: connectedAccounts, live: automationVersions.definition })
    .from(automations)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, automations.connectedAccountId))
    .leftJoin(automationVersions, eq(automationVersions.id, automations.currentVersionId))
    .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, id)))
  if (!row) return
  await db().delete(automations).where(eq(automations.id, id))
  if (row.automation.status === 'active' && iceBreakerItems(id, row.live).length > 0) {
    await clearIceBreakersQuietly(row.account)
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @replyooo/web test ice-breakers automations`
Expected: PASS. `automations.test.ts` still makes no Meta calls; if it did, msw isn't installed in that file and the real `fetch` would fail loudly.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @replyooo/web typecheck`
Expected: clean.

```bash
git add apps/web/src/lib/meta.ts apps/web/src/lib/data apps/web/test/ice-breakers.test.ts
git commit -m "feat(web): sync conversation starters with Meta on publish, pause and delete"
```

---

### Task 8: Contacts, home stats and safe CSV export

**Files:**
- Create: `apps/web/src/lib/data/contacts.ts`, `apps/web/src/lib/csv.ts`
- Modify: `apps/web/src/lib/data/types.ts`, `apps/web/src/lib/data/index.ts`, `apps/web/src/lib/data/memory.ts`, `apps/web/src/lib/data/seed.ts`
- Modify: `apps/web/src/app/(app)/contacts/page.tsx`, `apps/web/src/app/(app)/contacts/contact-drawer.tsx`, `apps/web/src/app/api/contacts/export/route.ts`, `apps/web/src/app/(app)/home/page.tsx`, `apps/web/src/app/(app)/automations/page.tsx`
- Delete: `apps/web/test/data.test.ts`
- Test: `apps/web/test/contacts.test.ts`, `apps/web/test/csv.test.ts`

**Interfaces:**
- Consumes: `statsSince`, `DM_KINDS` (Task 6); `createContact`, `createRun`, `createMessage` (Task 6 support); `isUuid`.
- Produces:
  ```ts
  // lib/data/types.ts (changed)
  interface Contact { id; accountId; username: string; name: string; email: string | null; phone: string | null;
                      tags: string[]; fields: Record<string, string>; firstSeenAt: string; lastInboundAt: string }
  interface ContactDetail extends Contact { messages: ContactMessage[]; runs: ContactRun[] }
  interface HomeStats { dmsSent: number; runs: number; completionRate: number; leads: number; liveCount: number }
  // lib/data/contacts.ts
  const CONTACTS_PAGE_SIZE = 200
  function listContacts(workspaceId, accountId, filters?: ContactFilters, options?: { limit?: number }): Promise<Contact[]>
  function countContacts(workspaceId, accountId): Promise<{ total: number; leads: number }>
  function listTags(workspaceId, accountId): Promise<string[]>
  function listLatestLeads(workspaceId, accountId, limit?: number): Promise<Contact[]>
  function getContactDetail(workspaceId, accountId, id): Promise<ContactDetail | null>
  function getHomeStats(workspaceId, accountId, now?: Date): Promise<HomeStats>
  function messageText(body: Record<string, unknown>): string
  // lib/csv.ts
  function csvCell(value: string): string
  function toCsv(header: readonly string[], rows: string[][]): string
  ```
- Display fallbacks: `username` = `username ?? platformUserId`, `name` = `name ??` that username, `lastInboundAt` = `lastInboundAt ?? firstSeenAt`.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/csv.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { csvCell, toCsv } from '@/lib/csv'

describe('csvCell', () => {
  it('quotes values and escapes quotes', () => {
    expect(csvCell('Sam "the" Eater')).toBe('"Sam ""the"" Eater"')
  })

  it('neutralises formulas', () => {
    expect(csvCell('=HYPERLINK("https://evil.com")')).toBe(`"'=HYPERLINK(""https://evil.com"")"`)
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`)
    expect(csvCell('-2+3')).toBe(`"'-2+3"`)
    expect(csvCell('+1(555)HYPERLINK')).toBe(`"'+1(555)HYPERLINK"`)
  })

  it('leaves international phone numbers alone', () => {
    expect(csvCell('+91 98765 43210')).toBe('"+91 98765 43210"')
    expect(csvCell('+1 (555) 010-0199')).toBe('"+1 (555) 010-0199"')
  })
})

describe('toCsv', () => {
  it('joins rows with CRLF under an unquoted header', () => {
    expect(toCsv(['a', 'b'], [['1', '2']])).toBe('a,b\r\n"1","2"')
  })
})
```

`apps/web/test/contacts.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import * as automationData from '@/lib/data/automations'
import {
  countContacts,
  getContactDetail,
  getHomeStats,
  listContacts,
  listLatestLeads,
  listTags,
  messageText,
} from '@/lib/data/contacts'
import { createAccount, createContact, createMessage, createRun, createWorkspace } from './support'

async function setup() {
  const { workspaceId } = await createWorkspace()
  const account = await createAccount(workspaceId)
  return { workspaceId, accountId: account.id }
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000)

describe('listContacts', () => {
  it('filters by search, tag and lead type within one account', async () => {
    const { workspaceId, accountId } = await setup()
    const other = await createAccount(workspaceId)
    await createContact(workspaceId, accountId, { username: 'sam.eats', name: 'Sam Eats', phone: '+15550100', tags: ['vip'] })
    await createContact(workspaceId, accountId, { username: 'priya', email: 'priya@example.com', tags: ['email-lead'] })
    await createContact(workspaceId, accountId, { username: 'lurker' })
    await createContact(workspaceId, other.id, { username: 'elsewhere', phone: '+15550199' })

    const names = async (filters = {}) => (await listContacts(workspaceId, accountId, filters)).map((c) => c.username).sort()
    expect(await names()).toEqual(['lurker', 'priya', 'sam.eats'])
    expect(await names({ q: 'SAM.EATS' })).toEqual(['sam.eats'])
    expect(await names({ q: 'example.com' })).toEqual(['priya'])
    expect(await names({ has: 'phone' })).toEqual(['sam.eats'])
    expect(await names({ has: 'email' })).toEqual(['priya'])
    expect(await names({ tag: 'vip' })).toEqual(['sam.eats'])
    expect(await names({ q: '%' })).toEqual([])
  })

  it('orders by last activity and honours the limit', async () => {
    const { workspaceId, accountId } = await setup()
    await createContact(workspaceId, accountId, { username: 'old', lastInboundAt: minutesAgo(30) })
    await createContact(workspaceId, accountId, { username: 'new', lastInboundAt: minutesAgo(1) })
    await createContact(workspaceId, accountId, { username: 'silent', lastInboundAt: null })
    expect((await listContacts(workspaceId, accountId)).map((c) => c.username)).toEqual(['new', 'old', 'silent'])
    expect(await listContacts(workspaceId, accountId, {}, { limit: 1 })).toHaveLength(1)
  })

  it('fills in display names for contacts Meta didn’t give us a profile for', async () => {
    const { workspaceId, accountId } = await setup()
    const contact = await createContact(workspaceId, accountId, { username: null, name: null, platformUserId: 'igsid_42' })
    const [listed] = await listContacts(workspaceId, accountId)
    expect(listed).toMatchObject({ id: contact.id, username: 'igsid_42', name: 'igsid_42' })
  })

  it('never returns another workspace’s contacts', async () => {
    const a = await setup()
    const b = await setup()
    const contact = await createContact(a.workspaceId, a.accountId, { email: 'x@example.com', tags: ['secret'] })
    expect(await listContacts(b.workspaceId, a.accountId)).toEqual([])
    expect(await countContacts(b.workspaceId, a.accountId)).toEqual({ total: 0, leads: 0 })
    expect(await listTags(b.workspaceId, a.accountId)).toEqual([])
    expect(await getContactDetail(b.workspaceId, a.accountId, contact.id)).toBeNull()
    expect(await getContactDetail(a.workspaceId, a.accountId, 'con_1')).toBeNull()
  })
})

describe('countContacts, listTags and listLatestLeads', () => {
  it('summarises the account’s audience', async () => {
    const { workspaceId, accountId } = await setup()
    await createContact(workspaceId, accountId, { email: 'a@example.com', tags: ['b-tag', 'a-tag'] })
    await createContact(workspaceId, accountId, { phone: '+15550100', tags: ['a-tag'] })
    await createContact(workspaceId, accountId)

    expect(await countContacts(workspaceId, accountId)).toEqual({ total: 3, leads: 2 })
    expect(await listTags(workspaceId, accountId)).toEqual(['a-tag', 'b-tag'])
    expect(await listLatestLeads(workspaceId, accountId)).toHaveLength(2)
  })
})

describe('getContactDetail', () => {
  it('returns messages oldest first and run history with automation names', async () => {
    const { workspaceId, accountId } = await setup()
    const automation = await automationData.createAutomation(workspaceId, accountId, 'comment_to_dm')
    if (!automation) throw new Error('no automation')
    await automationData.publishAutomation(workspaceId, automation.id)
    const contact = await createContact(workspaceId, accountId)
    const run = await createRun({ automationId: automation.id, contactId: contact.id, accountId, status: 'waiting' })
    await createMessage({ contactId: contact.id, accountId, direction: 'in', kind: 'comment', body: { text: 'GUIDE', mediaId: 'm1' }, createdAt: minutesAgo(3) })
    await createMessage({ contactId: contact.id, accountId, runId: run.id, kind: 'private_reply', body: { type: 'message', message: { text: 'Tap below 👇' } }, createdAt: minutesAgo(2) })
    await createMessage({ contactId: contact.id, accountId, direction: 'in', kind: 'postback', body: { payload: 'r:x', title: 'Send it to me' }, createdAt: minutesAgo(1) })

    const detail = await getContactDetail(workspaceId, accountId, contact.id)
    expect(detail?.messages.map((m) => [m.direction, m.text])).toEqual([
      ['in', 'GUIDE'],
      ['out', 'Tap below 👇'],
      ['in', 'Send it to me'],
    ])
    expect(detail?.runs).toEqual([{ automationName: automation.name, status: 'waiting', at: run.createdAt.toISOString() }])
  })
})

describe('getHomeStats', () => {
  it('counts this account’s last-30-day activity', async () => {
    const { workspaceId, accountId } = await setup()
    const automation = await automationData.createAutomation(workspaceId, accountId, 'dm_keyword')
    if (!automation) throw new Error('no automation')
    await automationData.publishAutomation(workspaceId, automation.id)
    const lead = await createContact(workspaceId, accountId, { email: 'lead@example.com' })
    const run = await createRun({ automationId: automation.id, contactId: lead.id, accountId, status: 'completed' })
    await createRun({ automationId: automation.id, contactId: lead.id, accountId, status: 'failed' })
    await createMessage({ contactId: lead.id, accountId, runId: run.id, kind: 'dm' })
    await createMessage({ contactId: lead.id, accountId, runId: run.id, kind: 'dm', createdAt: new Date(Date.now() - 31 * 86_400_000) })

    expect(await getHomeStats(workspaceId, accountId)).toEqual({ dmsSent: 1, runs: 2, completionRate: 0.5, leads: 1, liveCount: 1 })
  })
})

describe('messageText', () => {
  it('reads text from inbound, outbound, comment-reply, image and postback bodies', () => {
    expect(messageText({ text: 'hi' })).toBe('hi')
    expect(messageText({ type: 'message', message: { text: 'Here you go' } })).toBe('Here you go')
    expect(messageText({ type: 'comment', text: 'Sent!' })).toBe('Sent!')
    expect(messageText({ type: 'image', url: 'https://x' })).toBe('📷 Photo')
    expect(messageText({ payload: 'r:1', title: 'Yes please' })).toBe('Yes please')
    expect(messageText({ text: null, isReaction: true })).toBe('')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @replyooo/web test contacts csv`
Expected: FAIL. `@/lib/data/contacts` and `@/lib/csv` can't be resolved.

- [ ] **Step 3: Implement CSV and the contacts repository**

`apps/web/src/lib/csv.ts`:
```ts
const FORMULA_START = /^[=+\-@\t\r]/
/** `+91 98765 43210`: only digits and separators, so a spreadsheet can't run it. */
const PHONE = /^\+[\d\s().-]+$/

/** Quote every cell and neutralise spreadsheet formula injection without mangling phone numbers. */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) && !PHONE.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

export function toCsv(header: readonly string[], rows: string[][]): string {
  return [header.join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\r\n')
}
```

In `apps/web/src/lib/data/types.ts`, replace the `Contact` interface with the two below and add `HomeStats`:
```ts
export interface Contact {
  id: string
  accountId: string
  username: string
  name: string
  email: string | null
  phone: string | null
  tags: string[]
  fields: Record<string, string>
  firstSeenAt: string
  lastInboundAt: string
}

export interface ContactDetail extends Contact {
  messages: ContactMessage[]
  runs: ContactRun[]
}

export interface HomeStats {
  dmsSent: number
  runs: number
  completionRate: number
  leads: number
  liveCount: number
}
```

`apps/web/src/lib/data/contacts.ts`:
```ts
import 'server-only'
import { automations, contacts, flowRuns, messages } from '@replyooo/db'
import { and, arrayContains, desc, eq, gte, ilike, inArray, isNotNull, or, type SQL, sql } from 'drizzle-orm'
import { db } from '../db'
import { DM_KINDS, statsSince } from './automations'
import { isUuid } from './ids'
import type { Contact, ContactDetail, ContactFilters, HomeStats } from './types'

export const CONTACTS_PAGE_SIZE = 200
const MESSAGE_LIMIT = 50
const RUN_LIMIT = 20

const columns = {
  id: contacts.id,
  accountId: contacts.connectedAccountId,
  platformUserId: contacts.platformUserId,
  username: contacts.username,
  name: contacts.name,
  email: contacts.email,
  phone: contacts.phone,
  tags: contacts.tags,
  fields: contacts.fields,
  firstSeenAt: contacts.firstSeenAt,
  lastInboundAt: contacts.lastInboundAt,
}

interface ContactRow {
  id: string
  accountId: string
  platformUserId: string
  username: string | null
  name: string | null
  email: string | null
  phone: string | null
  tags: string[]
  fields: Record<string, string>
  firstSeenAt: Date
  lastInboundAt: Date | null
}

const LEAD = sql`(${contacts.email} is not null or ${contacts.phone} is not null)`
const count = () => sql<number>`count(*)`.mapWith(Number)

function toContact(row: ContactRow): Contact {
  const username = row.username ?? row.platformUserId
  return {
    id: row.id,
    accountId: row.accountId,
    username,
    name: row.name ?? username,
    email: row.email,
    phone: row.phone,
    tags: row.tags,
    fields: row.fields,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastInboundAt: (row.lastInboundAt ?? row.firstSeenAt).toISOString(),
  }
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`)

function scope(workspaceId: string, accountId: string, filters: ContactFilters = {}): SQL | undefined {
  const q = filters.q?.trim()
  const pattern = q ? `%${escapeLike(q)}%` : undefined
  return and(
    eq(contacts.workspaceId, workspaceId),
    eq(contacts.connectedAccountId, accountId),
    pattern
      ? or(
          ilike(contacts.username, pattern),
          ilike(contacts.name, pattern),
          ilike(contacts.email, pattern),
          ilike(contacts.phone, pattern),
        )
      : undefined,
    filters.tag ? arrayContains(contacts.tags, [filters.tag]) : undefined,
    filters.has === 'email' ? isNotNull(contacts.email) : undefined,
    filters.has === 'phone' ? isNotNull(contacts.phone) : undefined,
  )
}

export async function listContacts(
  workspaceId: string,
  accountId: string,
  filters: ContactFilters = {},
  options: { limit?: number } = {},
): Promise<Contact[]> {
  if (!isUuid(accountId)) return []
  const query = db()
    .select(columns)
    .from(contacts)
    .where(scope(workspaceId, accountId, filters))
    .orderBy(sql`${contacts.lastInboundAt} desc nulls last`, desc(contacts.firstSeenAt))
    .$dynamic()
  const rows = options.limit ? await query.limit(options.limit) : await query
  return rows.map(toContact)
}

export async function countContacts(workspaceId: string, accountId: string): Promise<{ total: number; leads: number }> {
  if (!isUuid(accountId)) return { total: 0, leads: 0 }
  const [row] = await db()
    .select({ total: count(), leads: sql<number>`count(*) filter (where ${LEAD})`.mapWith(Number) })
    .from(contacts)
    .where(scope(workspaceId, accountId))
  return row ?? { total: 0, leads: 0 }
}

export async function listTags(workspaceId: string, accountId: string): Promise<string[]> {
  if (!isUuid(accountId)) return []
  const rows = await db()
    .selectDistinct({ tag: sql<string>`unnest(${contacts.tags})` })
    .from(contacts)
    .where(scope(workspaceId, accountId))
  return rows.map((row) => row.tag).sort()
}

export async function listLatestLeads(workspaceId: string, accountId: string, limit = 6): Promise<Contact[]> {
  if (!isUuid(accountId)) return []
  const rows = await db()
    .select(columns)
    .from(contacts)
    .where(and(scope(workspaceId, accountId), LEAD))
    .orderBy(desc(contacts.updatedAt))
    .limit(limit)
  return rows.map(toContact)
}

/** Text to show for a stored message body (inbound events, outbound sends, comment replies, postbacks). */
export function messageText(body: Record<string, unknown>): string {
  if (typeof body.text === 'string') return body.text
  if (body.type === 'message') {
    const message = body.message as { text?: unknown } | undefined
    if (typeof message?.text === 'string') return message.text
  }
  if (body.type === 'image') return '📷 Photo'
  if (typeof body.title === 'string') return body.title
  return ''
}

export async function getContactDetail(workspaceId: string, accountId: string, id: string): Promise<ContactDetail | null> {
  if (!isUuid(accountId) || !isUuid(id)) return null
  const [row] = await db()
    .select(columns)
    .from(contacts)
    .where(and(scope(workspaceId, accountId), eq(contacts.id, id)))
  if (!row) return null

  const [recent, runs] = await Promise.all([
    db()
      .select({ direction: messages.direction, body: messages.body, at: messages.createdAt })
      .from(messages)
      .where(eq(messages.contactId, id))
      .orderBy(desc(messages.createdAt))
      .limit(MESSAGE_LIMIT),
    db()
      .select({ automationName: automations.name, status: flowRuns.status, at: flowRuns.createdAt })
      .from(flowRuns)
      .innerJoin(automations, eq(automations.id, flowRuns.automationId))
      .where(eq(flowRuns.contactId, id))
      .orderBy(desc(flowRuns.createdAt))
      .limit(RUN_LIMIT),
  ])

  return {
    ...toContact(row),
    messages: recent
      .reverse()
      .map((m) => ({ direction: m.direction, text: messageText(m.body), at: m.at.toISOString() }))
      .filter((m) => m.text !== ''),
    runs: runs.map((r) => ({ automationName: r.automationName, status: r.status, at: r.at.toISOString() })),
  }
}

export async function getHomeStats(workspaceId: string, accountId: string, now = new Date()): Promise<HomeStats> {
  if (!isUuid(accountId)) return { dmsSent: 0, runs: 0, completionRate: 0, leads: 0, liveCount: 0 }
  const since = statsSince(now)
  const [[runs], [sent], audience, [live]] = await Promise.all([
    db()
      .select({ total: count(), completed: sql<number>`count(*) filter (where ${flowRuns.status} = 'completed')`.mapWith(Number) })
      .from(flowRuns)
      .innerJoin(automations, eq(automations.id, flowRuns.automationId))
      .where(
        and(eq(automations.workspaceId, workspaceId), eq(flowRuns.connectedAccountId, accountId), gte(flowRuns.createdAt, since)),
      ),
    db()
      .select({ total: count() })
      .from(messages)
      .innerJoin(contacts, eq(contacts.id, messages.contactId))
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          eq(messages.connectedAccountId, accountId),
          eq(messages.direction, 'out'),
          eq(messages.status, 'sent'),
          inArray(messages.kind, [...DM_KINDS]),
          gte(messages.createdAt, since),
        ),
      ),
    countContacts(workspaceId, accountId),
    db()
      .select({ total: count() })
      .from(automations)
      .where(
        and(
          eq(automations.workspaceId, workspaceId),
          eq(automations.connectedAccountId, accountId),
          eq(automations.status, 'active'),
        ),
      ),
  ])
  const total = runs?.total ?? 0
  return {
    dmsSent: sent?.total ?? 0,
    runs: total,
    completionRate: total === 0 ? 0 : (runs?.completed ?? 0) / total,
    leads: audience.leads,
    liveCount: live?.total ?? 0,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @replyooo/web test contacts csv`
Expected: PASS.

- [ ] **Step 5: Shrink the in-memory store to workspace-only data**

Replace `apps/web/src/lib/data/seed.ts` with:
```ts
import type { Member, Subscription, Workspace } from './types'

const DAY = 86_400_000

/** Remaining demo data until members and billing move to Postgres (Task 9). */
export function seed() {
  const workspace: Workspace = { id: 'ws_1', name: 'Maya Makes', user: { name: 'Maya Lopez', email: 'maya@mayamakes.co' } }
  const members: Member[] = [{ id: 'mem_1', name: 'Maya Lopez', email: 'maya@mayamakes.co', role: 'owner' }]
  const subscription: Subscription = {
    plan: 'pro',
    contactsReached: 0,
    contactsLimit: 5_000,
    periodEnd: new Date(Date.now() + 18 * DAY).toISOString(),
  }
  return { workspace, members, subscription }
}
```

Replace `apps/web/src/lib/data/memory.ts` with:
```ts
import 'server-only'
import { seed } from './seed'
import type { Member } from './types'

/** Remaining in-memory workspace data; Task 9 replaces it with workspace.ts. */
const store: ReturnType<typeof seed> = ((globalThis as { __replyoooStore?: ReturnType<typeof seed> }).__replyoooStore ??=
  seed())

const clone = <T>(value: T): T => structuredClone(value)

export async function getWorkspace() {
  return clone(store.workspace)
}

export async function listMembers() {
  return clone(store.members)
}

export async function inviteMember(email: string): Promise<Member> {
  const member: Member = { id: `mem_${crypto.randomUUID().slice(0, 8)}`, name: email.split('@')[0] ?? email, email, role: 'member' }
  store.members.push(member)
  return clone(member)
}

export async function removeMember(id: string) {
  store.members = store.members.filter((m) => m.id !== id || m.role === 'owner')
}

export async function getSubscription() {
  return clone(store.subscription)
}

export async function deleteWorkspaceData() {
  store.members = store.members.filter((m) => m.role === 'owner')
}
```

In `apps/web/src/lib/data/index.ts`, add `export * from './contacts'` after the automations line.

Delete `apps/web/test/data.test.ts`. Its remaining `listContacts` case is covered by `contacts.test.ts`.

- [ ] **Step 6: Rewire contacts, export, home and automations pages**

In `apps/web/src/app/(app)/contacts/page.tsx`:
- change the data import to `import { CONTACTS_PAGE_SIZE, countContacts, getContactDetail, listContacts, listTags } from '@/lib/data'`
- replace the lines from `const { account } = await getCurrentAccount()` through `const leadCount = …` with:
```tsx
  const { workspace, account } = await getCurrentAccount()
  const ws = workspace.workspaceId
  const [contacts, counts, tags, selected] = await Promise.all([
    listContacts(ws, account.id, filters, { limit: CONTACTS_PAGE_SIZE }),
    countContacts(ws, account.id),
    listTags(ws, account.id),
    typeof params.contact === 'string' ? getContactDetail(ws, account.id, params.contact) : null,
  ])
  const exportQuery = new URLSearchParams(Object.entries(filters).filter((e): e is [string, string] => Boolean(e[1])))
```
- in the subtitle, change `formatNumber(all.length)` to `formatNumber(counts.total)` and `formatNumber(leadCount)` to `formatNumber(counts.leads)`
- in the empty state, change both `all.length === 0` to `counts.total === 0`
- directly after `</table>` (inside the `: (` branch), add a footer for capped lists. Wrap the table and footer in a fragment:
```tsx
          <>
            <table className="w-full text-left">
              {/* …unchanged… */}
            </table>
            {contacts.length === CONTACTS_PAGE_SIZE && (
              <p className="border-t border-line px-5 py-3 text-[12.5px] text-subtle">
                Showing the {formatNumber(CONTACTS_PAGE_SIZE)} most recently active. Export CSV to get everyone.
              </p>
            )}
          </>
```
- the `{selected && <ContactDrawer contact={selected} />}` line stays the same

In `apps/web/src/app/(app)/contacts/contact-drawer.tsx`, change the type import to `import type { ContactDetail, ContactRun } from '@/lib/data/types'` and the prop to `{ contact }: { contact: ContactDetail }`.

Replace `apps/web/src/app/api/contacts/export/route.ts` with:
```ts
import { parseContactFilters } from '@/lib/contact-filters'
import { toCsv } from '@/lib/csv'
import { listContacts } from '@/lib/data'
import { getCurrentAccount } from '@/lib/session'

const COLUMNS = ['username', 'name', 'email', 'phone', 'tags', 'first_seen_at', 'last_active_at'] as const

export async function GET(request: Request) {
  const { workspace, account } = await getCurrentAccount()
  const contacts = await listContacts(workspace.workspaceId, account.id, parseContactFilters(new URL(request.url).searchParams))
  const csv = toCsv(
    COLUMNS,
    contacts.map((c) => [c.username, c.name, c.email ?? '', c.phone ?? '', c.tags.join(' '), c.firstSeenAt, c.lastInboundAt]),
  )
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="contacts-${account.username}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
```

In `apps/web/src/app/(app)/home/page.tsx`:
- change the data import to `import { getHomeStats, getSubscription, listAutomations, listLatestLeads } from '@/lib/data'`
- replace the data block (from `const { workspace: ctx, account }` through `const firstName = …`) with:
```tsx
  const { workspace, account } = await getCurrentAccount()
  const [stats, subscription, automations, leads] = await Promise.all([
    getHomeStats(workspace.workspaceId, account.id),
    getSubscription(),
    listAutomations(workspace.workspaceId, account.id),
    listLatestLeads(workspace.workspaceId, account.id),
  ])
  const top = automations.filter((a) => a.status !== 'draft').slice(0, 4)
  const usage = subscription.contactsReached / subscription.contactsLimit
  const firstName = workspace.user.name.split(' ')[0]
```

In `apps/web/src/app/(app)/automations/page.tsx`, change `getHomeStats(account.id)` to `getHomeStats(workspace.workspaceId, account.id)`.

- [ ] **Step 7: Verify**

Run: `pnpm --filter @replyooo/web typecheck && pnpm --filter @replyooo/web test`
Expected: clean typecheck, all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add -A apps/web/src apps/web/test
git commit -m "feat(web): read contacts and dashboard stats from Postgres"
```

---
### Task 9: Members, invitations, subscription and workspace deletion

**Files:**
- Create: `apps/web/src/lib/data/workspace.ts`
- Modify: `apps/web/src/lib/data/types.ts`, `apps/web/src/lib/data/index.ts`, `apps/web/src/app/actions.ts` (full replacement), `apps/web/src/app/(app)/settings/page.tsx` (full replacement), `apps/web/src/app/(app)/layout.tsx`, `apps/web/src/app/(app)/home/page.tsx`
- Delete: `apps/web/src/lib/data/memory.ts`, `apps/web/src/lib/data/seed.ts`
- Test: `apps/web/test/workspace-data.test.ts`

**Interfaces:**
- Consumes: `Role`, `canManage`, `listWorkspaces` (Task 3); `PLAN_LIMITS`, `usagePeriod`, `periodEnd`, `PlanKey` (Task 1); `requireWorkspace`, `getCurrentAccount`, cookies (Task 5).
- Produces:
  ```ts
  // lib/data/types.ts (changed)
  export type { Role } from '../workspaces'
  interface Member { id: string; userId: string; name: string; email: string; role: Role }
  interface Invitation { id: string; email: string; role: Role; createdAt: string }
  interface Subscription { plan: PlanKey; contactsReached: number; contactsLimit: number; periodEnd: string }
  // (Workspace interface removed; use WorkspaceContext)
  // lib/data/workspace.ts
  type InviteResult = 'invited' | 'member' | 'invalid'
  function listMembers(workspaceId): Promise<Member[]>
  function listInvitations(workspaceId): Promise<Invitation[]>
  function inviteMember(workspaceId, invitedByUserId: string, email: string): Promise<InviteResult>
  function revokeInvitation(workspaceId, id): Promise<void>
  function removeMember(workspaceId, memberId): Promise<void>          // never removes the owner
  function getSubscription(workspaceId, now?: Date): Promise<Subscription>
  function deleteWorkspace(workspaceId): Promise<void>                 // cascades everything
  // app/actions.ts (added)
  function switchWorkspace(workspaceId: string): Promise<void>
  function revokeInvitation(id: string): Promise<void>
  ```

- [ ] **Step 1: Write the failing test**

`apps/web/test/workspace-data.test.ts`:
```ts
import { connectedAccounts, subscriptions, usageCounters, workspaceMembers } from '@replyooo/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  deleteWorkspace,
  getSubscription,
  inviteMember,
  listInvitations,
  listMembers,
  removeMember,
  revokeInvitation,
} from '@/lib/data/workspace'
import { db } from '@/lib/db'
import { createAccount, createUser, createWorkspace } from './support'

describe('members and invitations', () => {
  it('lists members with their names and emails', async () => {
    const { workspaceId, user } = await createWorkspace('Crew')
    expect(await listMembers(workspaceId)).toEqual([
      expect.objectContaining({ userId: user.id, name: user.name, email: user.email, role: 'owner' }),
    ])
  })

  it('invites new people once, lower-cased, and refuses existing members and bad emails', async () => {
    const { workspaceId, user } = await createWorkspace('Crew')
    expect(await inviteMember(workspaceId, user.id, '  Sam@Example.com ')).toBe('invited')
    expect(await inviteMember(workspaceId, user.id, 'sam@example.com')).toBe('invited')
    expect(await inviteMember(workspaceId, user.id, user.email.toUpperCase())).toBe('member')
    expect(await inviteMember(workspaceId, user.id, 'not-an-email')).toBe('invalid')
    expect((await listInvitations(workspaceId)).map((i) => i.email)).toEqual(['sam@example.com'])
  })

  it('revokes invitations only within the workspace', async () => {
    const a = await createWorkspace('A')
    const b = await createWorkspace('B')
    await inviteMember(a.workspaceId, a.user.id, 'pat@example.com')
    const [invite] = await listInvitations(a.workspaceId)
    if (!invite) throw new Error('no invite')
    await revokeInvitation(b.workspaceId, invite.id)
    expect(await listInvitations(a.workspaceId)).toHaveLength(1)
    await revokeInvitation(a.workspaceId, invite.id)
    expect(await listInvitations(a.workspaceId)).toEqual([])
  })

  it('removes members but never the owner, and only within the workspace', async () => {
    const { workspaceId } = await createWorkspace('Crew')
    const other = await createWorkspace('Other')
    const teammate = await createUser({ name: 'Teammate' })
    await db().insert(workspaceMembers).values({ workspaceId, userId: teammate.id, role: 'member' })
    const members = await listMembers(workspaceId)
    const owner = members.find((m) => m.role === 'owner')
    const member = members.find((m) => m.userId === teammate.id)
    if (!owner || !member) throw new Error('missing members')

    await removeMember(workspaceId, owner.id)
    await removeMember(other.workspaceId, member.id)
    expect(await listMembers(workspaceId)).toHaveLength(2)
    await removeMember(workspaceId, member.id)
    expect((await listMembers(workspaceId)).map((m) => m.role)).toEqual(['owner'])
  })
})

describe('getSubscription', () => {
  it('reads the plan, this month’s usage and the reset date', async () => {
    const { workspaceId } = await createWorkspace('Billing')
    await db().insert(subscriptions).values({ workspaceId, plan: 'pro' })
    await db().insert(usageCounters).values([
      { workspaceId, period: '2026-10', contactsReached: 321 },
      { workspaceId, period: '2026-09', contactsReached: 999 },
    ])
    expect(await getSubscription(workspaceId, new Date('2026-10-06T10:00:00.000Z'))).toEqual({
      plan: 'pro',
      contactsReached: 321,
      contactsLimit: 5_000,
      periodEnd: '2026-11-01T00:00:00.000Z',
    })
  })

  it('defaults to the free plan with no usage', async () => {
    const { workspaceId } = await createWorkspace('Fresh')
    expect(await getSubscription(workspaceId, new Date('2026-10-06T10:00:00.000Z'))).toMatchObject({
      plan: 'free',
      contactsReached: 0,
      contactsLimit: 1_000,
    })
  })
})

describe('deleteWorkspace', () => {
  it('removes the workspace and everything it owns', async () => {
    const { workspaceId } = await createWorkspace('Doomed')
    const account = await createAccount(workspaceId)
    await deleteWorkspace(workspaceId)
    expect(await db().select().from(connectedAccounts).where(eq(connectedAccounts.id, account.id))).toEqual([])
    expect(await listMembers(workspaceId)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @replyooo/web test workspace-data`
Expected: FAIL. `@/lib/data/workspace` can't be resolved.

- [ ] **Step 3: Implement the repository and update types**

In `apps/web/src/lib/data/types.ts`:
- change the shared import to `import type { FlowDefinition, PlanKey, Platform } from '@replyooo/shared'`
- add `export type { Role } from '../workspaces'` and `import type { Role } from '../workspaces'`
- delete the `Workspace` interface
- replace `Member` and `Subscription` with:
```ts
export interface Member {
  id: string
  userId: string
  name: string
  email: string
  role: Role
}

export interface Invitation {
  id: string
  email: string
  role: Role
  createdAt: string
}

export interface Subscription {
  plan: PlanKey
  contactsReached: number
  contactsLimit: number
  periodEnd: string
}
```

`apps/web/src/lib/data/workspace.ts`:
```ts
import 'server-only'
import { authUsers, subscriptions, usageCounters, workspaceInvitations, workspaceMembers, workspaces } from '@replyooo/db'
import { PLAN_LIMITS, periodEnd, usagePeriod } from '@replyooo/shared'
import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { db } from '../db'
import { isUuid } from './ids'
import type { Invitation, Member, Subscription } from './types'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type InviteResult = 'invited' | 'member' | 'invalid'

export async function listMembers(workspaceId: string): Promise<Member[]> {
  return db()
    .select({
      id: workspaceMembers.id,
      userId: workspaceMembers.userId,
      name: authUsers.name,
      email: authUsers.email,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(authUsers, eq(authUsers.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.createdAt), asc(workspaceMembers.id))
}

export async function listInvitations(workspaceId: string): Promise<Invitation[]> {
  const rows = await db()
    .select()
    .from(workspaceInvitations)
    .where(eq(workspaceInvitations.workspaceId, workspaceId))
    .orderBy(asc(workspaceInvitations.createdAt))
  return rows.map((row) => ({ id: row.id, email: row.email, role: row.role, createdAt: row.createdAt.toISOString() }))
}

/** Saves a pending invite. It's accepted when someone with that verified email signs in (lib/workspaces.ts). */
export async function inviteMember(workspaceId: string, invitedByUserId: string, rawEmail: string): Promise<InviteResult> {
  const email = rawEmail.trim().toLowerCase()
  if (!EMAIL.test(email)) return 'invalid'
  const [existing] = await db()
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .innerJoin(authUsers, eq(authUsers.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), sql`lower(${authUsers.email}) = ${email}`))
  if (existing) return 'member'
  await db().insert(workspaceInvitations).values({ workspaceId, email, invitedByUserId }).onConflictDoNothing()
  return 'invited'
}

export async function revokeInvitation(workspaceId: string, id: string): Promise<void> {
  if (!isUuid(id)) return
  await db()
    .delete(workspaceInvitations)
    .where(and(eq(workspaceInvitations.workspaceId, workspaceId), eq(workspaceInvitations.id, id)))
}

export async function removeMember(workspaceId: string, memberId: string): Promise<void> {
  if (!isUuid(memberId)) return
  await db()
    .delete(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.id, memberId), ne(workspaceMembers.role, 'owner')),
    )
}

export async function getSubscription(workspaceId: string, now = new Date()): Promise<Subscription> {
  const [[subscription], [usage]] = await Promise.all([
    db()
      .select({ plan: subscriptions.plan, currentPeriodEnd: subscriptions.currentPeriodEnd })
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId)),
    db()
      .select({ contactsReached: usageCounters.contactsReached })
      .from(usageCounters)
      .where(and(eq(usageCounters.workspaceId, workspaceId), eq(usageCounters.period, usagePeriod(now)))),
  ])
  const plan = subscription?.plan ?? 'free'
  return {
    plan,
    contactsReached: usage?.contactsReached ?? 0,
    contactsLimit: PLAN_LIMITS[plan].contactsPerMonth,
    periodEnd: (subscription?.currentPeriodEnd ?? periodEnd(now)).toISOString(),
  }
}

/** Spec §5.2 data deletion: every table hangs off workspaces with ON DELETE CASCADE. */
export async function deleteWorkspace(workspaceId: string): Promise<void> {
  await db().delete(workspaces).where(eq(workspaces.id, workspaceId))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @replyooo/web test workspace-data`
Expected: PASS.

- [ ] **Step 5: Remove the in-memory store and finish the barrel**

Run: `git rm apps/web/src/lib/data/memory.ts apps/web/src/lib/data/seed.ts`

Replace `apps/web/src/lib/data/index.ts` with:
```ts
export type * from './types'
export * from './accounts'
export * from './automations'
export * from './contacts'
export * from './workspace'
```

- [ ] **Step 6: Replace the server actions**

Replace `apps/web/src/app/actions.ts` with:
```ts
'use server'

import { FlowDefinitionSchema } from '@replyooo/shared'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import * as data from '@/lib/data'
import { db } from '@/lib/db'
import { ACCOUNT_COOKIE, COOKIE_OPTIONS, WORKSPACE_COOKIE, getCurrentAccount, requireWorkspace } from '@/lib/session'
import { canManage, listWorkspaces } from '@/lib/workspaces'

async function requireManager() {
  const workspace = await requireWorkspace()
  if (!canManage(workspace.role)) throw new Error('Only owners and admins can do that')
  return workspace
}

export async function switchAccount(accountId: string) {
  const { workspaceId } = await requireWorkspace()
  if (!(await data.getAccount(workspaceId, accountId))) return
  ;(await cookies()).set(ACCOUNT_COOKIE, accountId, COOKIE_OPTIONS)
  revalidatePath('/', 'layout')
}

export async function switchWorkspace(workspaceId: string) {
  const { user } = await requireWorkspace()
  if (!(await listWorkspaces(db(), user.id)).some((w) => w.id === workspaceId)) return
  const jar = await cookies()
  jar.set(WORKSPACE_COOKIE, workspaceId, COOKIE_OPTIONS)
  jar.delete(ACCOUNT_COOKIE)
  redirect('/home')
}

export async function createAutomation(templateKey: string | null) {
  const { workspace, account } = await getCurrentAccount()
  const automation = await data.createAutomation(workspace.workspaceId, account.id, templateKey)
  if (!automation) redirect('/connect')
  redirect(`/automations/${automation.id}`)
}

export async function saveDraft(id: string, name: string, flow: unknown) {
  const { workspaceId } = await requireWorkspace()
  // Drafts may be incomplete, but they must still be well-formed JSON of the right shape.
  const parsed = FlowDefinitionSchema.safeParse(flow)
  if (!parsed.success) return { ok: false as const, error: 'Fix the highlighted fields before saving' }
  if (!(await data.saveDraft(workspaceId, id, { name, flow: parsed.data }))) {
    return { ok: false as const, error: 'This automation no longer exists' }
  }
  revalidatePath('/automations')
  return { ok: true as const, savedAt: new Date().toISOString() }
}

export async function publishAutomation(id: string, name: string, flow: unknown): Promise<data.PublishResult> {
  const saved = await saveDraft(id, name, flow)
  if (!saved.ok) return { ok: false, errors: [saved.error] }
  const { workspaceId } = await requireWorkspace()
  const result = await data.publishAutomation(workspaceId, id)
  revalidatePath('/automations')
  revalidatePath(`/automations/${id}`)
  return result
}

export async function setAutomationStatus(id: string, status: 'active' | 'paused'): Promise<data.StatusResult> {
  const { workspaceId } = await requireWorkspace()
  const result = await data.setAutomationStatus(workspaceId, id, status)
  revalidatePath('/automations')
  return result
}

export async function deleteAutomation(id: string) {
  const { workspaceId } = await requireWorkspace()
  await data.deleteAutomation(workspaceId, id)
  revalidatePath('/automations')
}

export async function disconnectAccount(id: string) {
  const { workspaceId } = await requireManager()
  await data.disconnectAccount(workspaceId, id)
  revalidatePath('/', 'layout')
}

export async function inviteMember(formData: FormData) {
  const workspace = await requireManager()
  const result = await data.inviteMember(workspace.workspaceId, workspace.user.id, String(formData.get('email') ?? ''))
  revalidatePath('/settings')
  redirect(`/settings?invite=${result}#members`)
}

export async function revokeInvitation(id: string) {
  const { workspaceId } = await requireManager()
  await data.revokeInvitation(workspaceId, id)
  revalidatePath('/settings')
}

export async function removeMember(id: string) {
  const { workspaceId } = await requireManager()
  await data.removeMember(workspaceId, id)
  revalidatePath('/settings')
}

export async function deleteWorkspace(formData: FormData) {
  const workspace = await requireWorkspace()
  if (workspace.role !== 'owner') return
  if (String(formData.get('confirm') ?? '').trim() !== workspace.workspaceName) return
  await data.deleteWorkspace(workspace.workspaceId)
  const jar = await cookies()
  jar.delete(ACCOUNT_COOKIE)
  jar.delete(WORKSPACE_COOKIE)
  redirect('/')
}
```

- [ ] **Step 7: Rewire settings, layout and home**

Replace `apps/web/src/app/(app)/settings/page.tsx` with:
```tsx
import { PLAN_LIMITS } from '@replyooo/shared'
import { Check, Plus, TriangleAlert } from 'lucide-react'
import type { Metadata } from 'next'
import {
  deleteWorkspace,
  disconnectAccount,
  inviteMember,
  removeMember,
  revokeInvitation,
  switchWorkspace,
} from '@/app/actions'
import { PlatformIcon } from '@/components/sidebar'
import { Avatar, ButtonLink, Card, PageHeader, buttonClass, cx, formatCompact, formatNumber } from '@/components/ui'
import { getSubscription, listAccounts, listInvitations, listMembers } from '@/lib/data'
import { db } from '@/lib/db'
import { requireWorkspace } from '@/lib/session'
import { canManage, listWorkspaces } from '@/lib/workspaces'

export const metadata: Metadata = { title: 'Settings' }

const PLANS = [
  { key: 'free', name: 'Free', price: '$0', features: ['1 connected account', '3 live automations', 'Replyooo branding'] },
  { key: 'pro', name: 'Pro', price: '$12', features: ['3 connected accounts', 'Unlimited automations', 'Follow gate & lead capture'] },
  { key: 'business', name: 'Business', price: '$29', features: ['10 connected accounts', 'Team members', 'Priority support'] },
] as const

const INVITE_NOTICES: Record<string, string> = {
  invited: 'Invite saved. They join as soon as they sign in with Google using that address.',
  member: 'That person is already in this workspace.',
  invalid: 'That doesn’t look like an email address.',
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const [{ invite }, workspace] = await Promise.all([searchParams, requireWorkspace()])
  const [accounts, members, invitations, subscription, workspaces] = await Promise.all([
    listAccounts(workspace.workspaceId),
    listMembers(workspace.workspaceId),
    listInvitations(workspace.workspaceId),
    getSubscription(workspace.workspaceId),
    listWorkspaces(db(), workspace.user.id),
  ])
  const manager = canManage(workspace.role)
  const usage = subscription.contactsReached / subscription.contactsLimit
  const notice = invite ? INVITE_NOTICES[invite] : undefined

  return (
    <div className="mx-auto max-w-[920px] px-10 py-9">
      <PageHeader title="Settings" subtitle={workspace.workspaceName} />

      {workspaces.length > 1 && (
        <SettingsSection id="workspaces" title="Workspaces" description="Workspaces you belong to.">
          <Card className="divide-y divide-line">
            {workspaces.map((w) => (
              <div key={w.id} className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold">{w.name}</div>
                  <div className="text-[12.5px] capitalize text-subtle">{w.role}</div>
                </div>
                {w.id === workspace.workspaceId ? (
                  <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-green">
                    <Check className="size-3.5" /> Current
                  </span>
                ) : (
                  <form action={switchWorkspace.bind(null, w.id)}>
                    <button type="submit" className={buttonClass('secondary', 'sm')}>
                      Switch
                    </button>
                  </form>
                )}
              </div>
            ))}
          </Card>
        </SettingsSection>
      )}

      <SettingsSection id="accounts" title="Connected accounts" description="Instagram professional accounts and Facebook Pages Replyooo replies on.">
        <Card className="divide-y divide-line">
          {accounts.map((account) => (
            <div key={account.id} className="flex items-center gap-3 p-4">
              <Avatar name={account.username} size={40} />
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-semibold">@{account.username}</div>
                <div className="flex items-center gap-1.5 text-[12.5px] text-subtle">
                  <PlatformIcon platform={account.platform} className="size-3" />
                  {account.platform === 'instagram' ? 'Instagram' : 'Facebook Page'}
                  {account.followers !== null && <> · {formatCompact(account.followers)} followers</>}
                </div>
              </div>
              {account.status === 'reauth_required' ? (
                <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-brand">
                  <TriangleAlert className="size-3.5" /> Needs reconnect
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-green">
                  <Check className="size-3.5" /> Connected
                </span>
              )}
              {account.status === 'reauth_required' && (
                <ButtonLink href={`/connect?platform=${account.platform}`} size="sm">
                  Reconnect
                </ButtonLink>
              )}
              {manager && (
                <form action={disconnectAccount.bind(null, account.id)}>
                  <button type="submit" className={buttonClass('ghost', 'sm')}>
                    Disconnect
                  </button>
                </form>
              )}
            </div>
          ))}
          <div className="p-4">
            <ButtonLink href="/connect" variant="secondary" size="sm">
              <Plus className="size-4" /> Connect account
            </ButtonLink>
          </div>
        </Card>
      </SettingsSection>

      <SettingsSection id="members" title="Members" description="People who can edit automations and see contacts.">
        <Card className="divide-y divide-line">
          {members.map((member) => (
            <div key={member.id} className="flex items-center gap-3 p-4">
              <Avatar name={member.name} size={36} />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold">
                  {member.name}
                  {member.userId === workspace.user.id && <span className="font-normal text-subtle"> (you)</span>}
                </div>
                <div className="text-[12.5px] text-subtle">{member.email}</div>
              </div>
              <span className="rounded-full bg-sand px-2.5 py-0.5 text-[12px] font-medium capitalize">{member.role}</span>
              {manager && member.role !== 'owner' && member.userId !== workspace.user.id && (
                <form action={removeMember.bind(null, member.id)}>
                  <button type="submit" className={buttonClass('ghost', 'sm')}>
                    Remove
                  </button>
                </form>
              )}
            </div>
          ))}
          {invitations.map((invitation) => (
            <div key={invitation.id} className="flex items-center gap-3 p-4">
              <Avatar name={invitation.email} size={36} />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold">{invitation.email}</div>
                <div className="text-[12.5px] text-subtle">Invited · joins on their next Google sign-in</div>
              </div>
              <span className="rounded-full bg-cream px-2.5 py-0.5 text-[12px] font-medium">Pending</span>
              {manager && (
                <form action={revokeInvitation.bind(null, invitation.id)}>
                  <button type="submit" className={buttonClass('ghost', 'sm')}>
                    Revoke
                  </button>
                </form>
              )}
            </div>
          ))}
          {manager && (
            <form action={inviteMember} className="flex flex-col gap-2 p-4">
              <div className="flex gap-2">
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="teammate@example.com"
                  className="h-9 flex-1 rounded-full border border-line px-4 text-[13.5px] outline-none focus:border-ink"
                />
                <button type="submit" className={buttonClass('dark', 'sm')}>
                  Send invite
                </button>
              </div>
              {notice && <p className="text-[12.5px] text-muted">{notice}</p>}
            </form>
          )}
        </Card>
      </SettingsSection>

      <SettingsSection id="billing" title="Billing" description="Plans are metered on contacts reached per month.">
        <Card className="p-5">
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] font-semibold">This period</span>
            <span className="text-[13px] text-subtle">
              {formatNumber(subscription.contactsReached)} / {formatNumber(subscription.contactsLimit)} contacts reached
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-sand">
            <div className="h-full rounded-full bg-ink" style={{ width: `${Math.min(100, usage * 100)}%` }} />
          </div>
        </Card>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {PLANS.map((plan) => {
            const current = plan.key === subscription.plan
            return (
              <Card key={plan.key} className={cx('flex flex-col p-5', current && 'border-ink ring-1 ring-ink')}>
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-semibold">{plan.name}</span>
                  {current && <span className="rounded-full bg-lime px-2 py-0.5 text-[11px] font-semibold">Current</span>}
                </div>
                <div className="mt-2 font-display text-[30px] font-bold tracking-[-0.04em]">
                  {plan.price}
                  <span className="font-sans text-[13px] font-normal tracking-normal text-subtle">/month</span>
                </div>
                <ul className="mt-3 flex flex-col gap-1.5 text-[13px] text-muted">
                  <li>{formatNumber(PLAN_LIMITS[plan.key].contactsPerMonth)} contacts / month</li>
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                {/* Checkout and the customer portal are Dodo Payments links (Plan 4). */}
                <button type="button" disabled={current} className={cx(buttonClass(current ? 'secondary' : 'dark', 'sm'), 'mt-5')}>
                  {current ? 'Your plan' : `Switch to ${plan.name}`}
                </button>
              </Card>
            )
          })}
        </div>
      </SettingsSection>

      {workspace.role === 'owner' && (
        <SettingsSection id="danger" title="Delete workspace" description="Deletes every automation, contact and message, and disconnects all accounts. This can’t be undone.">
          <Card className="border-[#ffb59a] p-5">
            <form action={deleteWorkspace} className="flex flex-wrap items-center gap-2">
              <input
                name="confirm"
                required
                placeholder={`Type “${workspace.workspaceName}” to confirm`}
                className="h-9 flex-1 rounded-full border border-line px-4 text-[13.5px] outline-none focus:border-ink"
              />
              <button type="submit" className="h-9 rounded-full bg-[#c2330e] px-4 text-[13px] font-semibold text-white hover:bg-[#a52a0a]">
                Delete workspace
              </button>
            </form>
          </Card>
        </SettingsSection>
      )}
    </div>
  )
}

function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="mt-10 scroll-mt-8">
      <h2 className="text-[17px] font-semibold">{title}</h2>
      <p className="mt-0.5 mb-4 text-[13.5px] text-muted">{description}</p>
      {children}
    </section>
  )
}
```

In `apps/web/src/app/(app)/layout.tsx`, replace the `Promise.all` line with:
```tsx
  const { workspace, account, accounts } = await getCurrentAccount()
  const subscription = await getSubscription(workspace.workspaceId)
```

In `apps/web/src/app/(app)/home/page.tsx`, change `getSubscription()` to `getSubscription(workspace.workspaceId)`.

- [ ] **Step 8: Verify**

Run: `pnpm --filter @replyooo/web typecheck && pnpm --filter @replyooo/web test && grep -rn "memory\|seed()" apps/web/src || true`
Expected: clean typecheck, all tests PASS, and grep finds no references to the in-memory store.

- [ ] **Step 9: Commit**

```bash
git add -A apps/web/src apps/web/test
git commit -m "feat(web): move members, invitations and billing usage to Postgres"
```

---

### Task 10: Meta OAuth helpers (Instagram Login, Facebook Login for Business)

**Files:**
- Modify: `packages/meta/src/graph.ts`, `packages/meta/src/index.ts`
- Create: `packages/meta/src/oauth.ts`
- Test: `packages/meta/test/oauth.test.ts`, `packages/meta/test/graph.test.ts` (one added case)

**Interfaces:**
- Consumes: `graphRequest`, `GRAPH_API_VERSION`, `classifyGraphError`, `MetaError` (Plan 2).
- Produces:
  ```ts
  // graph.ts: GraphRequest.token becomes optional; no Authorization header when it's absent
  const INSTAGRAM_SCOPES: readonly string[]
  const FACEBOOK_SCOPES: readonly string[]
  interface OAuthApp { appId: string; appSecret: string; redirectUri: string; graphVersion?: string }
  interface InstagramConnection { externalId: string; username: string; displayName: string | null; avatarUrl: string | null;
                                  followersCount: number | null; accountType: string | null; accessToken: string; expiresAt: Date }
  interface FacebookPageConnection { externalId: string; username: string; displayName: string | null; avatarUrl: string | null;
                                     followersCount: number | null; accessToken: string }
  function instagramAuthorizeUrl(app: Pick<OAuthApp, 'appId' | 'redirectUri'>, state: string): string
  function exchangeInstagramCode(app: OAuthApp, code: string, now?: Date): Promise<InstagramConnection>
  function facebookAuthorizeUrl(app: Pick<OAuthApp, 'appId' | 'redirectUri' | 'graphVersion'>, state: string, configId?: string): string
  function exchangeFacebookCode(app: OAuthApp, code: string): Promise<FacebookPageConnection[]>
  ```
  Every HTTP failure throws `MetaError`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/meta/test/graph.test.ts`, inside `describe('graphRequest')`. It uses the file's existing `server` and `base`:
```ts
  it('omits the Authorization header when no token is given', async () => {
    let auth: string | null = 'unset'
    server.use(
      http.get(`${base}/thing`, ({ request }) => {
        auth = request.headers.get('authorization')
        return HttpResponse.json({ ok: true })
      }),
    )
    await graphRequest({ baseUrl: base, path: 'thing' })
    expect(auth).toBeNull()
  })
```

`packages/meta/test/oauth.test.ts`:
```ts
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  exchangeFacebookCode,
  exchangeInstagramCode,
  facebookAuthorizeUrl,
  instagramAuthorizeUrl,
  MetaError,
} from '../src'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const NOW = new Date('2026-10-06T10:00:00.000Z')
const igApp = { appId: 'ig-app', appSecret: 'ig-secret', redirectUri: 'https://app.test/api/meta/oauth/instagram/callback' }
const fbApp = { appId: 'fb-app', appSecret: 'fb-secret', redirectUri: 'https://app.test/api/meta/oauth/facebook/callback' }

function instagramHappyPath(tokenResponse: unknown) {
  const form: URLSearchParams[] = []
  server.use(
    http.post('https://api.instagram.com/oauth/access_token', async ({ request }) => {
      form.push(new URLSearchParams(await request.text()))
      return HttpResponse.json(tokenResponse as Record<string, unknown>)
    }),
    http.get('https://graph.instagram.com/access_token', ({ request }) => {
      const url = new URL(request.url)
      expect(url.searchParams.get('grant_type')).toBe('ig_exchange_token')
      expect(url.searchParams.get('client_secret')).toBe('ig-secret')
      expect(url.searchParams.get('access_token')).toBe('IG_SHORT')
      return HttpResponse.json({ access_token: 'IG_LONG', token_type: 'bearer', expires_in: 5_184_000 })
    }),
    http.get('https://graph.instagram.com/v24.0/me', ({ request }) => {
      expect(request.headers.get('authorization')).toBe('Bearer IG_LONG')
      return HttpResponse.json({
        user_id: '17841400000000001',
        username: 'maya.makes',
        name: 'Maya Makes',
        profile_picture_url: 'https://cdn.test/maya.jpg',
        account_type: 'MEDIA_CREATOR',
        followers_count: 412000,
      })
    }),
  )
  return form
}

describe('Instagram Login', () => {
  it('builds the authorize URL with business scopes and state', () => {
    const url = new URL(instagramAuthorizeUrl(igApp, 'nonce-1'))
    expect(url.origin + url.pathname).toBe('https://www.instagram.com/oauth/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'ig-app',
      redirect_uri: igApp.redirectUri,
      response_type: 'code',
      scope: 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments',
      state: 'nonce-1',
    })
  })

  it('exchanges a code for a long-lived token and the professional profile', async () => {
    const form = instagramHappyPath({ data: [{ access_token: 'IG_SHORT', user_id: '1', permissions: 'x' }] })
    const connection = await exchangeInstagramCode(igApp, 'CODE#_', NOW)

    expect(Object.fromEntries(form[0] ?? [])).toEqual({
      client_id: 'ig-app',
      client_secret: 'ig-secret',
      grant_type: 'authorization_code',
      redirect_uri: igApp.redirectUri,
      code: 'CODE',
    })
    expect(connection).toEqual({
      externalId: '17841400000000001',
      username: 'maya.makes',
      displayName: 'Maya Makes',
      avatarUrl: 'https://cdn.test/maya.jpg',
      followersCount: 412000,
      accountType: 'MEDIA_CREATOR',
      accessToken: 'IG_LONG',
      expiresAt: new Date('2026-12-05T10:00:00.000Z'),
    })
  })

  it('accepts the older flat token response', async () => {
    instagramHappyPath({ access_token: 'IG_SHORT', user_id: 1 })
    expect((await exchangeInstagramCode(igApp, 'CODE', NOW)).accessToken).toBe('IG_LONG')
  })

  it('turns an invalid code into a permanent MetaError', async () => {
    server.use(
      http.post('https://api.instagram.com/oauth/access_token', () =>
        HttpResponse.json({ error_type: 'OAuthException', code: 400, error_message: 'Invalid authorization code' }, { status: 400 }),
      ),
    )
    const error = await exchangeInstagramCode(igApp, 'BAD', NOW).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MetaError)
    expect(error).toMatchObject({ kind: 'permanent', message: 'Invalid authorization code' })
  })
})

describe('Facebook Login for Business', () => {
  it('uses the configuration id when one is set, scopes otherwise', () => {
    const withConfig = new URL(facebookAuthorizeUrl(fbApp, 'nonce-2', 'cfg-9'))
    expect(withConfig.origin + withConfig.pathname).toBe('https://www.facebook.com/v24.0/dialog/oauth')
    expect(withConfig.searchParams.get('config_id')).toBe('cfg-9')
    expect(withConfig.searchParams.get('scope')).toBeNull()
    expect(withConfig.searchParams.get('state')).toBe('nonce-2')

    const withScopes = new URL(facebookAuthorizeUrl(fbApp, 'nonce-3'))
    expect(withScopes.searchParams.get('scope')).toBe(
      'pages_show_list,pages_messaging,pages_manage_metadata,pages_read_engagement,pages_manage_engagement',
    )
  })

  it('exchanges a code for page tokens of every granted Page', async () => {
    server.use(
      http.get('https://graph.facebook.com/v24.0/oauth/access_token', ({ request }) => {
        const params = new URL(request.url).searchParams
        if (params.get('grant_type') === 'fb_exchange_token') {
          expect(params.get('fb_exchange_token')).toBe('FB_SHORT')
          return HttpResponse.json({ access_token: 'FB_LONG_USER', token_type: 'bearer' })
        }
        expect(Object.fromEntries(params)).toEqual({
          client_id: 'fb-app',
          client_secret: 'fb-secret',
          redirect_uri: fbApp.redirectUri,
          code: 'FBCODE',
        })
        return HttpResponse.json({ access_token: 'FB_SHORT', token_type: 'bearer', expires_in: 3600 })
      }),
      http.get('https://graph.facebook.com/v24.0/me/accounts', ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer FB_LONG_USER')
        return HttpResponse.json({
          data: [
            { id: 'page_1', name: 'Maya Makes Kitchen', username: 'mayamakeskitchen', access_token: 'PAGE_1', followers_count: 38200, picture: { data: { url: 'https://cdn.test/p1.jpg' } } },
            { id: 'page_2', name: 'No Token Page' },
          ],
        })
      }),
    )
    expect(await exchangeFacebookCode(fbApp, 'FBCODE')).toEqual([
      {
        externalId: 'page_1',
        username: 'mayamakeskitchen',
        displayName: 'Maya Makes Kitchen',
        avatarUrl: 'https://cdn.test/p1.jpg',
        followersCount: 38200,
        accessToken: 'PAGE_1',
      },
    ])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @replyooo/meta test oauth graph`
Expected: FAIL. The OAuth exports don't exist, and `graphRequest` requires `token`.

- [ ] **Step 3: Make the Graph token optional**

In `packages/meta/src/graph.ts`, change `token: string` in `GraphRequest` to `token?: string`, and replace the headers line with:
```ts
  const headers: Record<string, string> = {}
  if (req.token) headers.Authorization = `Bearer ${req.token}`
```

- [ ] **Step 4: Implement the OAuth helpers**

`packages/meta/src/oauth.ts`:
```ts
import { classifyGraphError, MetaError } from './errors'
import { GRAPH_API_VERSION, graphRequest } from './graph'

export const INSTAGRAM_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
] as const

export const FACEBOOK_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'pages_read_engagement',
  'pages_manage_engagement',
] as const

const IG_AUTHORIZE = 'https://www.instagram.com/oauth/authorize'
const IG_TOKEN = 'https://api.instagram.com/oauth/access_token'
const IG_GRAPH = 'https://graph.instagram.com'
const FB_GRAPH = 'https://graph.facebook.com'
const TIMEOUT_MS = 15_000

export interface OAuthApp {
  appId: string
  appSecret: string
  redirectUri: string
  graphVersion?: string
}

export interface InstagramConnection {
  /** `user_id` from /me: the professional account ID webhooks use as `entry.id`. */
  externalId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  followersCount: number | null
  /** `BUSINESS` or `MEDIA_CREATOR` for professional accounts. */
  accountType: string | null
  accessToken: string
  expiresAt: Date
}

export interface FacebookPageConnection {
  externalId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  followersCount: number | null
  /** Page token derived from a long-lived user token; it doesn't expire. */
  accessToken: string
}

export function instagramAuthorizeUrl(app: Pick<OAuthApp, 'appId' | 'redirectUri'>, state: string): string {
  const url = new URL(IG_AUTHORIZE)
  url.search = new URLSearchParams({
    client_id: app.appId,
    redirect_uri: app.redirectUri,
    response_type: 'code',
    scope: INSTAGRAM_SCOPES.join(','),
    state,
  }).toString()
  return url.toString()
}

export async function exchangeInstagramCode(app: OAuthApp, code: string, now = new Date()): Promise<InstagramConnection> {
  const short = await postForm<{ access_token?: string; data?: { access_token?: string }[] }>(IG_TOKEN, {
    client_id: app.appId,
    client_secret: app.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: app.redirectUri,
    // Instagram appends `#_` to the code in the redirect.
    code: code.replace(/#_$/, ''),
  })
  const shortToken = short.access_token ?? short.data?.[0]?.access_token
  if (!shortToken) throw new MetaError('permanent', 'Instagram did not return an access token', { reason: 'invalid_request' })

  const long = await graphRequest<{ access_token: string; expires_in: number }>({
    baseUrl: IG_GRAPH,
    path: 'access_token',
    query: { grant_type: 'ig_exchange_token', client_secret: app.appSecret, access_token: shortToken },
  })

  const me = await graphRequest<{
    user_id?: string | number
    username?: string
    name?: string
    profile_picture_url?: string
    account_type?: string
    followers_count?: number
  }>({
    baseUrl: `${IG_GRAPH}/${app.graphVersion ?? GRAPH_API_VERSION}`,
    path: 'me',
    token: long.access_token,
    query: { fields: 'user_id,username,name,profile_picture_url,account_type,followers_count' },
  })
  if (me.user_id === undefined || !me.username) {
    throw new MetaError('permanent', 'Instagram profile is missing user_id or username', { reason: 'invalid_request' })
  }

  return {
    externalId: String(me.user_id),
    username: me.username,
    displayName: me.name ?? null,
    avatarUrl: me.profile_picture_url ?? null,
    followersCount: me.followers_count ?? null,
    accountType: me.account_type ?? null,
    accessToken: long.access_token,
    expiresAt: new Date(now.getTime() + long.expires_in * 1000),
  }
}

export function facebookAuthorizeUrl(
  app: Pick<OAuthApp, 'appId' | 'redirectUri' | 'graphVersion'>,
  state: string,
  configId?: string,
): string {
  const url = new URL(`https://www.facebook.com/${app.graphVersion ?? GRAPH_API_VERSION}/dialog/oauth`)
  const params = new URLSearchParams({ client_id: app.appId, redirect_uri: app.redirectUri, state, response_type: 'code' })
  if (configId) params.set('config_id', configId)
  else params.set('scope', FACEBOOK_SCOPES.join(','))
  url.search = params.toString()
  return url.toString()
}

export async function exchangeFacebookCode(app: OAuthApp, code: string): Promise<FacebookPageConnection[]> {
  const baseUrl = `${FB_GRAPH}/${app.graphVersion ?? GRAPH_API_VERSION}`
  const short = await graphRequest<{ access_token: string }>({
    baseUrl,
    path: 'oauth/access_token',
    query: { client_id: app.appId, client_secret: app.appSecret, redirect_uri: app.redirectUri, code },
  })
  const long = await graphRequest<{ access_token: string }>({
    baseUrl,
    path: 'oauth/access_token',
    query: {
      grant_type: 'fb_exchange_token',
      client_id: app.appId,
      client_secret: app.appSecret,
      fb_exchange_token: short.access_token,
    },
  })
  const pages = await graphRequest<{
    data: {
      id: string
      name: string
      username?: string
      access_token?: string
      followers_count?: number
      picture?: { data?: { url?: string } }
    }[]
  }>({
    baseUrl,
    path: 'me/accounts',
    token: long.access_token,
    query: { fields: 'id,name,username,access_token,followers_count,picture{url}', limit: '100' },
  })
  return pages.data.flatMap((page) =>
    page.access_token
      ? [
          {
            externalId: page.id,
            username: page.username ?? page.name,
            displayName: page.name,
            avatarUrl: page.picture?.data?.url ?? null,
            followersCount: page.followers_count ?? null,
            accessToken: page.access_token,
          },
        ]
      : [],
  )
}

/** api.instagram.com answers with `{ error_type, code, error_message }` instead of Graph's `{ error }`. */
async function postForm<T>(url: string, fields: Record<string, string>): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { method: 'POST', body: new URLSearchParams(fields), signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (cause) {
    throw new MetaError('retryable', `OAuth request failed: ${(cause as Error).message}`, { reason: 'network' })
  }
  const body: unknown = await response.json().catch(() => ({}))
  const failed = body !== null && typeof body === 'object' && ('error_type' in body || 'error' in body)
  if (!response.ok || failed) {
    const instagram = body as { error_message?: string; code?: number }
    throw classifyGraphError(
      response.status,
      instagram.error_message ? { error: { message: instagram.error_message, code: instagram.code } } : body,
    )
  }
  return body as T
}
```

Append to `packages/meta/src/index.ts`:
```ts
export * from './oauth'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @replyooo/meta test && pnpm --filter @replyooo/meta typecheck && pnpm --filter @replyooo/worker typecheck`
Expected: all PASS. The worker still type-checks with the optional token.

- [ ] **Step 6: Commit**

```bash
git add packages/meta
git commit -m "feat(meta): add Instagram and Facebook OAuth code exchange"
```

---

### Task 11: Connect accounts through Meta OAuth

**Files:**
- Create: `apps/web/src/lib/connect.ts`, `apps/web/src/app/api/meta/oauth/[platform]/start/route.ts`, `apps/web/src/app/api/meta/oauth/[platform]/callback/route.ts`
- Modify: `apps/web/src/app/connect/page.tsx`
- Test: `apps/web/test/connect.test.ts`

**Interfaces:**
- Consumes: Task 10 OAuth helpers; `adapterFor`, `tokenKey` (Task 7); `encryptToken`; `requireWorkspace`, `ACCOUNT_COOKIE`, `COOKIE_OPTIONS` (Task 5); `env()`.
- Produces:
  ```ts
  const OAUTH_COOKIE = 'replyooo_oauth'
  type ConnectError = 'cancelled' | 'state_mismatch' | 'personal_account' | 'owned_elsewhere' | 'no_pages' | 'meta_error'
  type ConnectResult = { ok: true; accountIds: string[] } | { ok: false; error: ConnectError }
  function isPlatform(value: string): value is Platform
  function oauthApp(platform: Platform): OAuthApp
  function authorizeUrl(platform: Platform, state: string): string
  function stateMatches(cookie: string | undefined, platform: Platform, state: string | null): boolean
  function saveConnectedAccount(db: Db, workspaceId: string, userId: string, input: AccountInput): Promise<string | null>  // null = owned elsewhere
  function completeConnect(db: Db, platform: Platform, workspaceId: string, userId: string, code: string): Promise<ConnectResult>
  ```

- [ ] **Step 1: Write the failing test**

`apps/web/test/connect.test.ts`:
```ts
import { connectedAccounts, decryptToken } from '@replyooo/db'
import { eq } from 'drizzle-orm'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { completeConnect, stateMatches } from '@/lib/connect'
import { db } from '@/lib/db'
import { TOKEN_KEY, createAccount, createWorkspace } from './support'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const IG_ID = '17841400000000099'

function instagram(profile: Partial<{ account_type: string; followers_count: number }> = {}) {
  const subscribed: string[] = []
  server.use(
    http.post('https://api.instagram.com/oauth/access_token', () => HttpResponse.json({ data: [{ access_token: 'IG_SHORT' }] })),
    http.get('https://graph.instagram.com/access_token', () =>
      HttpResponse.json({ access_token: 'IG_LONG', expires_in: 5_184_000 }),
    ),
    http.get('https://graph.instagram.com/v24.0/me', () =>
      HttpResponse.json({
        user_id: IG_ID,
        username: 'maya.makes',
        name: 'Maya Makes',
        account_type: 'BUSINESS',
        followers_count: 412000,
        ...profile,
      }),
    ),
    http.post(`https://graph.instagram.com/v24.0/${IG_ID}/subscribed_apps`, ({ request }) => {
      subscribed.push(new URL(request.url).searchParams.get('subscribed_fields') ?? '')
      return HttpResponse.json({ success: true })
    }),
  )
  return subscribed
}

async function accountsFor(workspaceId: string) {
  return db().select().from(connectedAccounts).where(eq(connectedAccounts.workspaceId, workspaceId))
}

describe('stateMatches', () => {
  it('requires the same platform and nonce', () => {
    expect(stateMatches('instagram:abc', 'instagram', 'abc')).toBe(true)
    expect(stateMatches('instagram:abc', 'facebook', 'abc')).toBe(false)
    expect(stateMatches('instagram:abc', 'instagram', 'abd')).toBe(false)
    expect(stateMatches(undefined, 'instagram', 'abc')).toBe(false)
    expect(stateMatches('instagram:abc', 'instagram', null)).toBe(false)
  })
})

describe('connecting Instagram', () => {
  it('stores the account with an encrypted long-lived token and subscribes webhooks', async () => {
    const { workspaceId, user } = await createWorkspace('IG')
    const subscribed = instagram()

    const result = await completeConnect(db(), 'instagram', workspaceId, user.id, 'CODE')
    expect(result.ok).toBe(true)
    const [account] = await accountsFor(workspaceId)
    expect(account).toMatchObject({
      platform: 'instagram',
      externalId: IG_ID,
      username: 'maya.makes',
      followersCount: 412000,
      status: 'active',
      connectedByUserId: user.id,
    })
    expect(account && decryptToken(account.accessTokenEnc, TOKEN_KEY)).toBe('IG_LONG')
    expect(account?.tokenExpiresAt).toBeInstanceOf(Date)
    expect(subscribed).toEqual(['comments,messages,messaging_postbacks'])
  })

  it('rejects personal accounts without saving anything', async () => {
    const { workspaceId, user } = await createWorkspace('Personal')
    const subscribed = instagram({ account_type: 'PERSONAL' })
    expect(await completeConnect(db(), 'instagram', workspaceId, user.id, 'CODE')).toEqual({ ok: false, error: 'personal_account' })
    expect(await accountsFor(workspaceId)).toEqual([])
    expect(subscribed).toEqual([])
  })

  it('reconnecting refreshes the token and reactivates the same row', async () => {
    const { workspaceId, user } = await createWorkspace('Again')
    const existing = await createAccount(workspaceId, 'instagram', { externalId: IG_ID, status: 'reauth_required' })
    instagram({ followers_count: 500000 })

    expect(await completeConnect(db(), 'instagram', workspaceId, user.id, 'CODE')).toEqual({ ok: true, accountIds: [existing.id] })
    const rows = await accountsFor(workspaceId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: existing.id, status: 'active', followersCount: 500000 })
    expect(rows[0] && decryptToken(rows[0].accessTokenEnc, TOKEN_KEY)).toBe('IG_LONG')
  })

  it('refuses an account owned by another workspace and leaves it untouched', async () => {
    const owner = await createWorkspace('Owner')
    const intruder = await createWorkspace('Intruder')
    const existing = await createAccount(owner.workspaceId, 'instagram', { externalId: IG_ID })
    const subscribed = instagram()

    expect(await completeConnect(db(), 'instagram', intruder.workspaceId, intruder.user.id, 'CODE')).toEqual({
      ok: false,
      error: 'owned_elsewhere',
    })
    const [row] = await db().select().from(connectedAccounts).where(eq(connectedAccounts.id, existing.id))
    expect(row?.workspaceId).toBe(owner.workspaceId)
    expect(row && decryptToken(row.accessTokenEnc, TOKEN_KEY)).toBe('stored-token')
    expect(subscribed).toEqual([])
  })

  it('reports Meta failures without saving', async () => {
    const { workspaceId, user } = await createWorkspace('Broken')
    server.use(
      http.post('https://api.instagram.com/oauth/access_token', () =>
        HttpResponse.json({ error_type: 'OAuthException', code: 400, error_message: 'Invalid code' }, { status: 400 }),
      ),
    )
    expect(await completeConnect(db(), 'instagram', workspaceId, user.id, 'BAD')).toEqual({ ok: false, error: 'meta_error' })
    expect(await accountsFor(workspaceId)).toEqual([])
  })
})

describe('connecting Facebook Pages', () => {
  function facebook(pages: { id: string; name: string; access_token?: string }[]) {
    const subscribed: string[] = []
    server.use(
      http.get('https://graph.facebook.com/v24.0/oauth/access_token', ({ request }) =>
        HttpResponse.json({
          access_token: new URL(request.url).searchParams.get('grant_type') === 'fb_exchange_token' ? 'FB_LONG' : 'FB_SHORT',
        }),
      ),
      http.get('https://graph.facebook.com/v24.0/me/accounts', () => HttpResponse.json({ data: pages })),
      http.post('https://graph.facebook.com/v24.0/:pageId/subscribed_apps', ({ params }) => {
        subscribed.push(String(params.pageId))
        return HttpResponse.json({ success: true })
      }),
    )
    return subscribed
  }

  it('connects every granted Page and skips ones owned elsewhere', async () => {
    const other = await createWorkspace('Other')
    await createAccount(other.workspaceId, 'facebook', { externalId: 'page_taken' })
    const { workspaceId, user } = await createWorkspace('Pages')
    const subscribed = facebook([
      { id: 'page_a', name: 'Page A', access_token: 'PA' },
      { id: 'page_taken', name: 'Taken', access_token: 'PT' },
    ])

    const result = await completeConnect(db(), 'facebook', workspaceId, user.id, 'FBCODE')
    expect(result.ok && result.accountIds).toHaveLength(1)
    const rows = await accountsFor(workspaceId)
    expect(rows.map((r) => [r.externalId, r.tokenExpiresAt])).toEqual([['page_a', null]])
    expect(subscribed).toEqual(['page_a'])
  })

  it('reports when no Page was granted', async () => {
    const { workspaceId, user } = await createWorkspace('NoPages')
    facebook([])
    expect(await completeConnect(db(), 'facebook', workspaceId, user.id, 'FBCODE')).toEqual({ ok: false, error: 'no_pages' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @replyooo/web test connect`
Expected: FAIL. `@/lib/connect` can't be resolved.

- [ ] **Step 3: Implement the connect library**

`apps/web/src/lib/connect.ts`:
```ts
import 'server-only'
import { connectedAccounts, type Db, encryptToken } from '@replyooo/db'
import {
  exchangeFacebookCode,
  exchangeInstagramCode,
  facebookAuthorizeUrl,
  instagramAuthorizeUrl,
  MetaError,
  type OAuthApp,
} from '@replyooo/meta'
import type { Platform } from '@replyooo/shared'
import { and, eq, ne } from 'drizzle-orm'
import { env } from './env'
import { adapterFor, tokenKey } from './meta'

export const OAUTH_COOKIE = 'replyooo_oauth'

export type ConnectError = 'cancelled' | 'state_mismatch' | 'personal_account' | 'owned_elsewhere' | 'no_pages' | 'meta_error'
export type ConnectResult = { ok: true; accountIds: string[] } | { ok: false; error: ConnectError }

const PROFESSIONAL = new Set(['BUSINESS', 'MEDIA_CREATOR'])

export function isPlatform(value: string): value is Platform {
  return value === 'instagram' || value === 'facebook'
}

export function oauthApp(platform: Platform): OAuthApp {
  const e = env()
  const redirectUri = new URL(`/api/meta/oauth/${platform}/callback`, e.APP_URL).toString()
  return platform === 'instagram'
    ? { appId: e.INSTAGRAM_APP_ID, appSecret: e.INSTAGRAM_APP_SECRET, redirectUri, graphVersion: e.META_GRAPH_VERSION }
    : { appId: e.META_APP_ID, appSecret: e.META_APP_SECRET, redirectUri, graphVersion: e.META_GRAPH_VERSION }
}

export function authorizeUrl(platform: Platform, state: string): string {
  const app = oauthApp(platform)
  return platform === 'instagram' ? instagramAuthorizeUrl(app, state) : facebookAuthorizeUrl(app, state, env().META_LOGIN_CONFIG_ID)
}

/** The state cookie holds `<platform>:<nonce>`; the callback must echo the same nonce for the same platform. */
export function stateMatches(cookie: string | undefined, platform: Platform, state: string | null): boolean {
  return Boolean(cookie && state && cookie === `${platform}:${state}`)
}

interface AccountInput {
  platform: Platform
  externalId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  followersCount: number | null
  accessToken: string
  expiresAt: Date | null
}

async function ownedElsewhere(db: Db, workspaceId: string, platform: Platform, externalId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: connectedAccounts.id })
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.platform, platform),
        eq(connectedAccounts.externalId, externalId),
        ne(connectedAccounts.workspaceId, workspaceId),
      ),
    )
  return Boolean(row)
}

/**
 * Inserts the account or refreshes it in place. An account owned by another workspace is never
 * moved (the worker matches automations by account ID), so the upsert only updates our own row.
 * Returns null when the account belongs to someone else.
 */
export async function saveConnectedAccount(db: Db, workspaceId: string, userId: string, input: AccountInput): Promise<string | null> {
  const profile = {
    username: input.username,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    followersCount: input.followersCount,
    accessTokenEnc: encryptToken(input.accessToken, tokenKey()),
    tokenExpiresAt: input.expiresAt,
    status: 'active' as const,
    connectedByUserId: userId,
  }
  const [row] = await db
    .insert(connectedAccounts)
    .values({ workspaceId, platform: input.platform, externalId: input.externalId, ...profile })
    .onConflictDoUpdate({
      target: [connectedAccounts.platform, connectedAccounts.externalId],
      set: profile,
      setWhere: eq(connectedAccounts.workspaceId, workspaceId),
    })
    .returning({ id: connectedAccounts.id })
  return row?.id ?? null
}

async function connectInstagram(db: Db, workspaceId: string, userId: string, code: string): Promise<ConnectResult> {
  const connection = await exchangeInstagramCode(oauthApp('instagram'), code)
  if (!connection.accountType || !PROFESSIONAL.has(connection.accountType)) return { ok: false, error: 'personal_account' }
  if (await ownedElsewhere(db, workspaceId, 'instagram', connection.externalId)) return { ok: false, error: 'owned_elsewhere' }

  await adapterFor('instagram').subscribeWebhooks({ externalId: connection.externalId, accessToken: connection.accessToken })
  const id = await saveConnectedAccount(db, workspaceId, userId, { platform: 'instagram', ...connection })
  return id ? { ok: true, accountIds: [id] } : { ok: false, error: 'owned_elsewhere' }
}

async function connectFacebook(db: Db, workspaceId: string, userId: string, code: string): Promise<ConnectResult> {
  const pages = await exchangeFacebookCode(oauthApp('facebook'), code)
  if (pages.length === 0) return { ok: false, error: 'no_pages' }

  const accountIds: string[] = []
  for (const page of pages) {
    if (await ownedElsewhere(db, workspaceId, 'facebook', page.externalId)) continue
    await adapterFor('facebook').subscribeWebhooks({ externalId: page.externalId, accessToken: page.accessToken })
    const id = await saveConnectedAccount(db, workspaceId, userId, { platform: 'facebook', ...page, expiresAt: null })
    if (id) accountIds.push(id)
  }
  return accountIds.length > 0 ? { ok: true, accountIds } : { ok: false, error: 'owned_elsewhere' }
}

export async function completeConnect(
  db: Db,
  platform: Platform,
  workspaceId: string,
  userId: string,
  code: string,
): Promise<ConnectResult> {
  try {
    return platform === 'instagram'
      ? await connectInstagram(db, workspaceId, userId, code)
      : await connectFacebook(db, workspaceId, userId, code)
  } catch (error) {
    if (error instanceof MetaError) return { ok: false, error: 'meta_error' }
    throw error
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @replyooo/web test connect`
Expected: PASS.

- [ ] **Step 5: Add the OAuth routes and connect-page errors**

Read `apps/web/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` for the route handler `params` signature in this Next version.

`apps/web/src/app/api/meta/oauth/[platform]/start/route.ts`:
```ts
import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { OAUTH_COOKIE, authorizeUrl, isPlatform } from '@/lib/connect'
import { COOKIE_OPTIONS, requireWorkspace } from '@/lib/session'

export async function GET(_request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params
  if (!isPlatform(platform)) return new Response('Not found', { status: 404 })
  await requireWorkspace()

  const state = randomUUID()
  ;(await cookies()).set(OAUTH_COOKIE, `${platform}:${state}`, { ...COOKIE_OPTIONS, maxAge: 600 })
  redirect(authorizeUrl(platform, state))
}
```

`apps/web/src/app/api/meta/oauth/[platform]/callback/route.ts`:
```ts
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { type ConnectError, OAUTH_COOKIE, completeConnect, isPlatform, stateMatches } from '@/lib/connect'
import { db } from '@/lib/db'
import { ACCOUNT_COOKIE, COOKIE_OPTIONS, requireWorkspace } from '@/lib/session'

export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params
  if (!isPlatform(platform)) return new Response('Not found', { status: 404 })
  const workspace = await requireWorkspace()
  const url = new URL(request.url)
  const jar = await cookies()
  const expected = jar.get(OAUTH_COOKIE)?.value
  jar.delete(OAUTH_COOKIE)

  const fail = (error: ConnectError) => redirect(`/connect?platform=${platform}&error=${error}`)
  if (!stateMatches(expected, platform, url.searchParams.get('state'))) return fail('state_mismatch')
  const code = url.searchParams.get('code')
  if (!code) return fail('cancelled')

  const result = await completeConnect(db(), platform, workspace.workspaceId, workspace.user.id, code)
  if (!result.ok) return fail(result.error)
  const [first] = result.accountIds
  if (first) jar.set(ACCOUNT_COOKIE, first, COOKIE_OPTIONS)
  redirect('/automations/new')
}
```

In `apps/web/src/app/connect/page.tsx`:
- change the `searchParams` type to `Promise<{ platform?: string; error?: string }>` and destructure `{ platform: highlight, error }`
- add above the component:
```tsx
const ERRORS: Record<string, string> = {
  cancelled: 'Connection was cancelled. Try again when you’re ready.',
  state_mismatch: 'That sign-in link expired. Start again from this page.',
  personal_account:
    'That Instagram account is personal. Switch it to a Professional (Business or Creator) account in the Instagram app, then try again.',
  owned_elsewhere: 'That account is already connected to another Replyooo workspace.',
  no_pages: 'We didn’t get access to any Facebook Pages. Try again and pick at least one Page.',
  meta_error: 'Meta didn’t accept the connection. Try again in a minute.',
}
```
- directly under the subtitle `<p>` inside `<main>`, add:
```tsx
        {error && ERRORS[error] && (
          <p role="alert" className="mx-auto mt-6 max-w-md rounded-2xl border border-[#ffd7c4] bg-brand-tint px-4 py-3 text-[13.5px] text-ink">
            {ERRORS[error]}
          </p>
        )}
```

- [ ] **Step 6: Verify**

Run: `pnpm --filter @replyooo/web typecheck && pnpm --filter @replyooo/web test`
Expected: clean typecheck, all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src apps/web/test/connect.test.ts
git commit -m "feat(web): connect Instagram and Facebook accounts through Meta OAuth"
```

---

### Task 12: Demo seed script and end-to-end verification

**Files:**
- Create: `apps/web/scripts/seed-demo.ts`
- Modify: `apps/web/package.json` (scripts)

**Interfaces:**
- Consumes: `createAuth` (Task 4), `resolveWorkspace` (Task 3), `createAutomation` / `publishAutomation` (Task 6), `encryptToken`, `usagePeriod`.
- Produces: `pnpm --filter @replyooo/web db:seed` creates the login `demo@replyooo.dev` / `replyooo-demo` with one Instagram account, three live automations, 24 contacts, runs and messages. It makes no Meta calls (no conversation-starter automation), and running it twice is a no-op.

- [ ] **Step 1: Write the seed script**

`apps/web/scripts/seed-demo.ts`:
```ts
/**
 * Local demo data so the dashboard has something to show without a real Meta account.
 * Login: demo@replyooo.dev / replyooo-demo. Safe to re-run (it stops if the user exists).
 *
 *   pnpm --filter @replyooo/web db:seed
 */
import { authUsers, automations, connectedAccounts, contacts, encryptToken, flowRuns, messages, usageCounters } from '@replyooo/db'
import { usagePeriod } from '@replyooo/shared'
import { eq } from 'drizzle-orm'
import { createAuth } from '../src/lib/auth'
import { createAutomation, publishAutomation } from '../src/lib/data/automations'
import { closeDb, db } from '../src/lib/db'
import { env } from '../src/lib/env'
import { tokenKey } from '../src/lib/meta'
import { resolveWorkspace } from '../src/lib/workspaces'

const EMAIL = 'demo@replyooo.dev'
const PASSWORD = 'replyooo-demo'
const TEMPLATES = ['email_list', 'comment_to_dm', 'follow_gate'] as const
const PEOPLE = [
  'sam.eats', 'priya.cooks', 'jules.bakes', 'noor.lifts', 'tomas.runs', 'aiko.plants', 'ben.brews', 'lena.reads',
  'omar.travels', 'zoe.knits', 'ravi.codes', 'mia.paints', 'leo.surfs', 'ines.sings', 'kai.climbs', 'ada.builds',
  'max.grills', 'eva.dances', 'raj.shoots', 'ivy.writes', 'tom.fixes', 'nia.teaches', 'yuki.draws', 'cal.rides',
]
const STATUSES = ['completed', 'completed', 'completed', 'waiting', 'failed'] as const
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000)

async function main() {
  const [existing] = await db().select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.email, EMAIL))
  if (existing) {
    console.log(`${EMAIL} already exists, nothing to do.`)
    return
  }

  const auth = createAuth({ db: db(), secret: env().BETTER_AUTH_SECRET, baseURL: env().APP_URL })
  const { user } = await auth.api.signUpEmail({ body: { name: 'Maya Lopez', email: EMAIL, password: PASSWORD } })
  const { workspaceId } = await resolveWorkspace(db(), { ...user, emailVerified: false })

  const [account] = await db()
    .insert(connectedAccounts)
    .values({
      workspaceId,
      platform: 'instagram',
      externalId: `demo_${user.id}`,
      username: 'maya.makes',
      displayName: 'Maya Makes',
      followersCount: 412_000,
      accessTokenEnc: encryptToken('demo-token-not-valid-for-meta', tokenKey()),
      connectedByUserId: user.id,
    })
    .returning()
  if (!account) throw new Error('account insert failed')

  const live: { id: string; versionId: string }[] = []
  for (const key of TEMPLATES) {
    const automation = await createAutomation(workspaceId, account.id, key)
    if (!automation) throw new Error(`could not create ${key}`)
    const published = await publishAutomation(workspaceId, automation.id)
    if (!published.ok) throw new Error(`could not publish ${key}: ${published.errors.join(', ')}`)
    const [row] = await db().select({ versionId: automations.currentVersionId }).from(automations).where(eq(automations.id, automation.id))
    if (row?.versionId) live.push({ id: automation.id, versionId: row.versionId })
  }
  // One draft so the list shows every state.
  await createAutomation(workspaceId, account.id, 'phone_numbers')

  for (const [index, username] of PEOPLE.entries()) {
    const [contact] = await db()
      .insert(contacts)
      .values({
        workspaceId,
        connectedAccountId: account.id,
        platformUserId: `demo_${index}`,
        username,
        name: username.split('.')[0]?.replace(/^./, (c) => c.toUpperCase()) ?? username,
        email: index % 3 === 0 ? `${username.replace('.', '')}@example.com` : null,
        phone: index % 5 === 1 ? `+91 98765 ${String(43210 + index).slice(-5)}` : null,
        tags: index % 4 === 0 ? ['email-lead', 'vip'] : index % 3 === 0 ? ['email-lead'] : [],
        lastInboundAt: minutesAgo(index * 37 + 2),
        firstSeenAt: minutesAgo(index * 600 + 60),
      })
      .returning()
    if (!contact) continue

    const automation = live[index % live.length]
    if (!automation) continue
    const status = STATUSES[index % STATUSES.length] ?? 'completed'
    const [run] = await db()
      .insert(flowRuns)
      .values({
        automationId: automation.id,
        automationVersionId: automation.versionId,
        contactId: contact.id,
        connectedAccountId: account.id,
        status,
        createdAt: minutesAgo(index * 37 + 5),
        completedAt: status === 'completed' ? minutesAgo(index * 37 + 3) : null,
      })
      .returning()

    await db().insert(messages).values([
      {
        contactId: contact.id,
        connectedAccountId: account.id,
        flowRunId: run?.id ?? null,
        direction: 'in',
        kind: 'comment',
        body: { text: 'GUIDE', mediaId: 'demo_media' },
        status: 'received',
        createdAt: minutesAgo(index * 37 + 6),
      },
      {
        contactId: contact.id,
        connectedAccountId: account.id,
        flowRunId: run?.id ?? null,
        direction: 'out',
        kind: 'private_reply',
        body: { type: 'message', message: { text: "Hey! Tap below and I'll send it over 👇" } },
        status: 'sent',
        sentAt: minutesAgo(index * 37 + 5),
        createdAt: minutesAgo(index * 37 + 5),
      },
    ])
  }

  await db().insert(usageCounters).values({ workspaceId, period: usagePeriod(new Date()), contactsReached: PEOPLE.length })
  console.log(`Seeded ${EMAIL} / ${PASSWORD}`)
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(closeDb)
```

In `apps/web/package.json`, add to `scripts`:
```json
    "db:seed": "tsx --env-file=.env.local --conditions=react-server scripts/seed-demo.ts"
```
(`--conditions=react-server` makes `server-only` resolve to its no-op export outside Next. If your `tsx` version rejects `--env-file`, use `node --env-file=.env.local --conditions=react-server --import tsx scripts/seed-demo.ts`.)

- [ ] **Step 2: Run the full automated suite**

Run: `pnpm typecheck && pnpm test`
Expected: all 6 packages typecheck clean; every suite PASSES (shared, engine, meta, db, worker, web).

- [ ] **Step 3: Build**

Run: `pnpm --filter @replyooo/web build`
Expected: `next build` succeeds. The route list includes `/api/auth/[...all]`, `/api/meta/oauth/[platform]/start`, `/api/meta/oauth/[platform]/callback` and `ƒ Proxy`. The build must not require production secrets, because `env()` is lazy. If a page fails because `env()` ran at build time, that page is missing a dynamic API call. Find the import path that calls `env()` at module scope and make it lazy instead.

- [ ] **Step 4: Manual smoke test against local Postgres**

```bash
docker compose up -d postgres
DATABASE_URL=postgres://replyooo:replyooo@localhost:5432/replyooo pnpm --filter @replyooo/db db:migrate
# apps/web/.env.local needs DATABASE_URL, APP_URL=http://localhost:3217, BETTER_AUTH_SECRET,
# TOKEN_ENCRYPTION_KEY, META_APP_ID/SECRET, INSTAGRAM_APP_ID/SECRET (dummy values are fine for this smoke test)
pnpm --filter @replyooo/web db:seed
pnpm --filter @replyooo/web exec next dev --port 3217
```
Use port 3217: ports 3000 and 3100 belong to other local projects. Then check:
1. `curl -sI localhost:3217/home` → `307` to `/login?next=%2Fhome` (proxy).
2. Log in at `/login` as `demo@replyooo.dev` / `replyooo-demo` → Home shows 24 contacts, leads, DMs sent and the top automations.
3. Automations → open one → edit a keyword → Publish → "Live", and the version count increases (`select version from automation_versions` in psql).
4. Contacts → filter "Has phone" → open a contact → the drawer shows the comment, the private reply and the run. Export CSV: phone numbers have **no** leading apostrophe.
5. Visit `/automations/aut_breakfast` → 404 page (not a 500).
6. Sign up a second user in a private window → lands on `/connect` with a new empty workspace. `/automations/<an id from the demo user>` → 404.
7. On `/connect`, run `curl -s -o /dev/null -w '%{redirect_url}' -b '<session cookie>' localhost:3217/api/meta/oauth/instagram/start`, or click "Continue with Instagram" → redirects to `https://www.instagram.com/oauth/authorize?client_id=…&state=…`.
8. `/connect?error=owned_elsewhere` shows the error banner.
9. Settings → invite `someone@example.com` → it appears as Pending. Log out via the sidebar → back on `/login`.

Stop the dev server afterwards (`Ctrl-C`). Leave the user's other dev servers alone.

- [ ] **Step 5: Commit**

```bash
git add apps/web/scripts/seed-demo.ts apps/web/package.json
git commit -m "chore(web): add a local demo seed script"
```
