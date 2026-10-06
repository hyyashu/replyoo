# Plan 4: Email, Billing, Plan Limits and Meta Compliance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Replyooo chargeable and ready for Meta App Review: transactional email (Resend and/or SMTP), email verification and password reset, invitation and reauth emails, enforced plan limits, Dodo Payments billing, Meta deauthorize/data-deletion callbacks, and the public pricing and legal pages.

**Architecture:** A new `@replyooo/email` package owns provider config (env), the Resend/SMTP/log transports with ordered failover, and the email templates; web and worker both use it. Plan limits are computed from one `effectivePlan()` in `@replyooo/shared`: the worker refuses to start new runs past the monthly contact limit, the web refuses to connect or publish past the account and live-automation limits. Dodo Payments is called with plain `fetch` (checkout, change-plan, customer portal) and keeps `subscriptions` in sync through a Standard-Webhooks-signed endpoint. Meta's signed-request callbacks key on a new `connected_accounts.meta_user_id`.

**Tech Stack:** pnpm + Turborepo, Next.js 16.3.8 (App Router, `src/proxy.ts`), Better Auth 1.7.7, Drizzle + Postgres 18, Hono/BullMQ worker, nodemailer (SMTP), Resend HTTP API, Dodo Payments REST API, Vitest 5 + Testcontainers, msw 3.

**Spec:** `docs/superpowers/specs/2026-10-05-replyooo-design.md` (§2.4 plan-limit routing, §3.6 billing, §5.1–5.3 onboarding/screens/endpoints, §6 error handling, §7 App Review readiness). Plan 3b (`docs/superpowers/plans/2026-10-06-plan-3b-postgres-auth-and-meta-connect.md`) is the code this builds on.

## Global Constraints

- **Every** server action calls `requireWorkspace()`, `getCurrentAccount()` or `requireManager()` on its first line; every query, UPDATE and DELETE on tenant data filters by `workspaceId`. **Exception (by design):** the Meta deauthorize/data-deletion callbacks (Task 11) are keyed by the Meta user from a verified `signed_request`, not by a session or workspace.
- apps/web tests stub HTTP with `mockFetch` from `apps/web/test/support.ts`. **Never** use msw `setupServer` in apps/web or packages/email: it patches `net.Socket` globally and breaks Postgres and SMTP sockets. (packages/meta has no DB and keeps its `setupServer` tests.)
- Dev servers only on port **3217**. Ports 3000 and 3100 belong to other local projects.
- Email env (web and worker): `EMAIL_PROVIDER` = comma-separated ordered list of `resend`, `smtp`, `log` (default `log`; the next provider is tried when one fails); `EMAIL_FROM`; `RESEND_API_KEY`; `SMTP_HOST`; `SMTP_PORT` (default `587`); `SMTP_SECURE` (default `true` only when port is `465`); `SMTP_USER`; `SMTP_PASS`. `log` is refused when `NODE_ENV=production`.
- Email is best-effort: a failed send is logged and **never** fails the user's action or a worker job.
- Billing env (web, all optional; billing UI is disabled with "Billing isn’t set up yet." until `DODO_API_KEY`, `DODO_PRODUCT_PRO` and `DODO_PRODUCT_BUSINESS` are set): `DODO_API_KEY`, `DODO_WEBHOOK_SECRET`, `DODO_ENVIRONMENT` (`test_mode` | `live_mode`, default `test_mode`), `DODO_PRODUCT_PRO`, `DODO_PRODUCT_BUSINESS`. Base URLs: `https://test.dodopayments.com`, `https://live.dodopayments.com`. Auth: `Authorization: Bearer <DODO_API_KEY>`.
- Dodo webhooks follow Standard Webhooks: headers `webhook-id`, `webhook-timestamp` (unix seconds), `webhook-signature` (space-separated `v1,<base64>`); signed content `${id}.${timestamp}.${rawBody}`; key = base64-decode of the secret after stripping `whsec_`; 5-minute timestamp tolerance; constant-time compare.
- A paid plan's limits apply while the subscription status is `active` or `past_due`, or `cancelled` before `current_period_end`; anything else falls back to `free` (`effectivePlan`, Task 2).
- Plan limits come from `PLAN_LIMITS` in `packages/shared/src/plans.ts`. Contact limit: new runs don't start, in-flight runs finish, and a contact already counted this period may still start runs. Usage resets on the 1st of each UTC month (`usage_counters.period`), independent of the billing date.
- Meta `signed_request` = `<base64url HMAC-SHA256 signature>.<base64url JSON payload>`, signed with the app secret over the payload segment; the payload's `algorithm` must be `HMAC-SHA256`. Facebook uses `META_APP_SECRET`, Instagram uses `INSTAGRAM_APP_SECRET`.
- User-facing copy uses curly apostrophes (`’`) like the existing UI.
- End every commit message with: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`

## Review Focus

1. **Dodo webhooks arrive out of order or are retried** (a `subscription.on_hold` from yesterday delivered after today's `subscription.renewed`): the older event must not overwrite newer state. Pinned in Task 8 ("ignores an event older than the stored one").
2. **A workspace at its monthly contact limit hears from a contact it already served this month**: that contact keeps getting replies; a brand-new contact gets no run and doesn't burn the 24h re-entry cooldown. Pinned in Task 3.
3. **The email provider is down during sign-up, an invite or a reset request**: the user's action still succeeds; with `EMAIL_PROVIDER=resend,smtp` the SMTP server gets the mail. Pinned in Task 1 (failover) and Task 5 (failing mailer).
4. **Password reset for an address with no account**: same response, no email sent (no account enumeration). Pinned in Task 5.
5. **Connecting several Facebook Pages with fewer free account slots than Pages**: connects up to the limit and tells the user the rest were skipped, instead of failing or silently dropping them. Pinned in Task 7.

---

## File Structure

| Path | Responsibility |
|---|---|
| `packages/email/src/config.ts` | Parse `EMAIL_*` env into `EmailConfig` |
| `packages/email/src/mailer.ts` | `Mailer` interface, Resend/SMTP/log transports, ordered failover, `createMailer` |
| `packages/email/src/templates.ts` | Verification, password reset, invitation, reauth emails (HTML + text) |
| `packages/email/src/testing.ts` | `RecordingMailer` for tests (subpath export `@replyooo/email/testing`) |
| `packages/db/src/queries.ts` | `accountAlertContext()`: who to email about an account |
| `packages/shared/src/plans.ts` | + `effectivePlan`, `PAID_STATUSES`, `PLAN_NAMES` |
| `packages/meta/src/signed-request.ts` | `parseSignedRequest()` |
| `apps/worker/src/limits.ts` | `mayStartRun()` contact-limit check |
| `apps/worker/src/alerts.ts` | `flagReauth()`: flag once + email owners/admins |
| `apps/web/src/lib/email.ts` | App mailer (lazy from env), `deliver()` fire-and-forget |
| `apps/web/src/lib/alerts.ts` | Reauth email from the web publish path |
| `apps/web/src/lib/data/limits.ts` | `workspacePlan()`, `liveAutomationBlock()` |
| `apps/web/src/lib/billing/dodo.ts` | Dodo REST client: checkout, change plan, portal |
| `apps/web/src/lib/billing/webhook.ts` | Standard Webhooks signature verification |
| `apps/web/src/lib/billing/sync.ts` | Apply `subscription.*` events to `subscriptions` |
| `apps/web/src/lib/billing/checkout.ts` | `startPlanChange()`: checkout vs in-place plan change |
| `apps/web/src/lib/meta-callbacks.ts` | Verify signed requests, deauthorize, delete Meta user data |
| `apps/web/src/lib/plans.ts` | `PLAN_CATALOG` display data for landing, /pricing, Settings |
| `apps/web/src/lib/legal.ts` | Company name / contact email / date shown on legal pages |
| `apps/web/src/components/marketing.tsx` | Marketing header, footer, pricing cards, legal page shell |

---

### Task 1: `@replyooo/email` package (config, Resend + SMTP + log, failover, templates)

**Files:**
- Create: `packages/email/package.json`, `packages/email/tsconfig.json`, `packages/email/vitest.config.ts`, `packages/email/src/index.ts`, `packages/email/src/config.ts`, `packages/email/src/mailer.ts`, `packages/email/src/templates.ts`, `packages/email/src/testing.ts`
- Modify: `.env.example`
- Test: `packages/email/test/config.test.ts`, `packages/email/test/resend.test.ts`, `packages/email/test/smtp.test.ts`, `packages/email/test/templates.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  // config.ts
  type EmailProvider = 'resend' | 'smtp' | 'log'
  interface EmailConfig {
    from: string
    providers: EmailProvider[]
    resend?: { apiKey: string }
    smtp?: { host: string; port: number; secure: boolean; user?: string; pass?: string }
  }
  function parseEmailConfig(source: Record<string, string | undefined>): EmailConfig // throws Error('Email is misconfigured: …')
  // mailer.ts
  interface EmailMessage { to: string; subject: string; html: string; text: string }
  interface Mailer { send(message: EmailMessage): Promise<void> }
  class EmailError extends Error
  function resendMailer(from: string, apiKey: string): Mailer
  function smtpMailer(from: string, smtp: NonNullable<EmailConfig['smtp']>): Mailer
  function logMailer(print?: (line: string) => void): Mailer
  function failoverMailer(mailers: Mailer[]): Mailer
  function createMailer(config: EmailConfig, options?: { print?: (line: string) => void }): Mailer
  // templates.ts
  interface RenderedEmail { subject: string; html: string; text: string }
  function escapeHtml(value: string): string
  function verificationEmail(input: { name: string; url: string }): RenderedEmail
  function passwordResetEmail(input: { name: string; url: string }): RenderedEmail
  function invitationEmail(input: { inviterName: string; workspaceName: string; url: string }): RenderedEmail
  function reauthEmail(input: { username: string; platform: 'instagram' | 'facebook'; workspaceName: string; url: string }): RenderedEmail
  // testing.ts (import from '@replyooo/email/testing')
  class RecordingMailer implements Mailer { sent: EmailMessage[]; failWith: Error | null; send(m): Promise<void>; clear(): void }
  ```

- [ ] **Step 1: Scaffold the package**

`packages/email/package.json`:
```json
{
  "name": "@replyooo/email",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./testing": "./src/testing.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@types/node": "^26.6.4",
    "typescript": "^7.0.2",
    "vitest": "^5.0.3"
  }
}
```

`packages/email/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/email/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { testTimeout: 30_000 },
})
```

Then add nodemailer and the SMTP test server (latest versions):
```bash
pnpm --filter @replyooo/email add nodemailer
pnpm --filter @replyooo/email add -D @types/nodemailer smtp-server @types/smtp-server
```

Create an empty `packages/email/src/index.ts` for now (filled in Step 9).

- [ ] **Step 2: Write the failing config test**

`packages/email/test/config.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseEmailConfig } from '../src/config'

describe('parseEmailConfig', () => {
  it('prints to the console when nothing is configured', () => {
    expect(parseEmailConfig({})).toEqual({ from: 'Replyooo <no-reply@localhost>', providers: ['log'] })
  })

  it('reads Resend', () => {
    expect(parseEmailConfig({ EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'Replyooo <hi@replyooo.test>', RESEND_API_KEY: 're_123' })).toEqual({
      from: 'Replyooo <hi@replyooo.test>',
      providers: ['resend'],
      resend: { apiKey: 're_123' },
    })
  })

  it('reads an ordered failover list with SMTP defaults', () => {
    expect(
      parseEmailConfig({
        EMAIL_PROVIDER: 'resend, smtp',
        EMAIL_FROM: 'hi@replyooo.test',
        RESEND_API_KEY: 're_123',
        SMTP_HOST: 'smtp.test',
        SMTP_USER: 'mailer',
        SMTP_PASS: 'secret',
      }),
    ).toEqual({
      from: 'hi@replyooo.test',
      providers: ['resend', 'smtp'],
      resend: { apiKey: 're_123' },
      smtp: { host: 'smtp.test', port: 587, secure: false, user: 'mailer', pass: 'secret' },
    })
  })

  it('uses implicit TLS on port 465 unless SMTP_SECURE says otherwise', () => {
    const base = { EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'hi@replyooo.test', SMTP_HOST: 'smtp.test' }
    expect(parseEmailConfig({ ...base, SMTP_PORT: '465' }).smtp).toEqual({ host: 'smtp.test', port: 465, secure: true })
    expect(parseEmailConfig({ ...base, SMTP_PORT: '465', SMTP_SECURE: 'false' }).smtp?.secure).toBe(false)
    expect(parseEmailConfig({ ...base, SMTP_PORT: '' }).smtp?.port).toBe(587)
  })

  it('names every missing setting', () => {
    expect(() => parseEmailConfig({ EMAIL_PROVIDER: 'resend,smtp' })).toThrow(
      'Email is misconfigured: RESEND_API_KEY is required for EMAIL_PROVIDER=resend; SMTP_HOST is required for EMAIL_PROVIDER=smtp; EMAIL_FROM is required to send real email',
    )
  })

  it('rejects unknown providers and log in production', () => {
    expect(() => parseEmailConfig({ EMAIL_PROVIDER: 'sendgrid' })).toThrow('Unknown EMAIL_PROVIDER "sendgrid"')
    expect(() => parseEmailConfig({ NODE_ENV: 'production' })).toThrow('EMAIL_PROVIDER=log only prints emails')
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @replyooo/email exec vitest run test/config.test.ts`
Expected: FAIL — `Cannot find module '../src/config'`.

- [ ] **Step 4: Implement `config.ts`**

`packages/email/src/config.ts`:
```ts
import { z } from 'zod'

export const EMAIL_PROVIDERS = ['resend', 'smtp', 'log'] as const
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number]

export interface EmailConfig {
  from: string
  /** Tried in order; the next one is used when a send fails. */
  providers: EmailProvider[]
  resend?: { apiKey: string }
  smtp?: { host: string; port: number; secure: boolean; user?: string; pass?: string }
}

const blank = (value: unknown) => (value === '' ? undefined : value)
const optional = z.preprocess(blank, z.string().min(1).optional())

const EnvSchema = z.object({
  NODE_ENV: optional,
  EMAIL_PROVIDER: z.preprocess(blank, z.string().default('log')),
  EMAIL_FROM: optional,
  RESEND_API_KEY: optional,
  SMTP_HOST: optional,
  SMTP_PORT: z.preprocess(blank, z.coerce.number().int().positive().default(587)),
  SMTP_SECURE: z.preprocess(blank, z.enum(['true', 'false']).optional()),
  SMTP_USER: optional,
  SMTP_PASS: optional,
})

const isProvider = (value: string): value is EmailProvider => (EMAIL_PROVIDERS as readonly string[]).includes(value)

/** Reads the EMAIL_* variables shared by web and worker (see .env.example). */
export function parseEmailConfig(source: Record<string, string | undefined>): EmailConfig {
  const env = EnvSchema.parse(source)
  const names = env.EMAIL_PROVIDER.split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  const problems: string[] = []
  const providers: EmailProvider[] = []
  for (const name of names) {
    if (isProvider(name)) providers.push(name)
    else problems.push(`Unknown EMAIL_PROVIDER "${name}" (use resend, smtp or log)`)
  }
  if (names.length === 0) problems.push('EMAIL_PROVIDER is empty')
  if (providers.includes('resend') && !env.RESEND_API_KEY) problems.push('RESEND_API_KEY is required for EMAIL_PROVIDER=resend')
  if (providers.includes('smtp') && !env.SMTP_HOST) problems.push('SMTP_HOST is required for EMAIL_PROVIDER=smtp')
  if (providers.some((p) => p !== 'log') && !env.EMAIL_FROM) problems.push('EMAIL_FROM is required to send real email')
  if (env.NODE_ENV === 'production' && providers.includes('log')) {
    problems.push('EMAIL_PROVIDER=log only prints emails; use resend or smtp in production')
  }
  if (problems.length > 0) throw new Error(`Email is misconfigured: ${problems.join('; ')}`)

  const config: EmailConfig = { from: env.EMAIL_FROM ?? 'Replyooo <no-reply@localhost>', providers }
  if (env.RESEND_API_KEY) config.resend = { apiKey: env.RESEND_API_KEY }
  if (env.SMTP_HOST) {
    config.smtp = {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : env.SMTP_PORT === 465,
      ...(env.SMTP_USER ? { user: env.SMTP_USER } : {}),
      ...(env.SMTP_PASS ? { pass: env.SMTP_PASS } : {}),
    }
  }
  return config
}
```

- [ ] **Step 5: Run the config test**

Run: `pnpm --filter @replyooo/email exec vitest run test/config.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Write the failing transport tests**

Resend and SMTP live in separate files: the SMTP test opens real sockets, and stubbing `fetch` with `vi.stubGlobal` keeps both files free of msw.

`packages/email/test/resend.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmailError, createMailer, failoverMailer, logMailer, resendMailer } from '../src/mailer'
import { RecordingMailer } from '../src/testing'

const message = { to: 'sam@example.com', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' }

function stubFetch(respond: () => Response) {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return respond()
    }),
  )
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('resendMailer', () => {
  it('posts the message to the Resend API with the key', async () => {
    const calls = stubFetch(() => Response.json({ id: 'email_1' }))
    await resendMailer('Replyooo <hi@replyooo.test>', 're_123').send(message)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.resend.com/emails')
    expect(calls[0]?.init.method).toBe('POST')
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe('Bearer re_123')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      from: 'Replyooo <hi@replyooo.test>',
      to: ['sam@example.com'],
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
    })
  })

  it('turns a rejection into an EmailError with Resend’s message', async () => {
    stubFetch(() => Response.json({ name: 'validation_error', message: 'Invalid `from` field' }, { status: 422 }))
    const error = await resendMailer('bad', 're_123').send(message).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EmailError)
    expect((error as Error).message).toBe('Resend rejected the email (422): Invalid `from` field')
  })
})

describe('failoverMailer', () => {
  it('uses the next provider when one fails, and reports every failure when all do', async () => {
    const down = new RecordingMailer()
    down.failWith = new Error('resend down')
    const backup = new RecordingMailer()
    await failoverMailer([down, backup]).send(message)
    expect(backup.sent).toEqual([message])

    backup.failWith = new Error('smtp down')
    await expect(failoverMailer([down, backup]).send(message)).rejects.toThrow(
      'Every email provider failed: resend down | smtp down',
    )
  })
})

describe('logMailer and createMailer', () => {
  it('prints the recipient, subject and text', async () => {
    const lines: string[] = []
    await logMailer((line) => lines.push(line)).send(message)
    expect(lines).toEqual(['[email] to=sam@example.com subject="Hello"\nHi'])
  })

  it('builds a single provider or a failover chain from config', async () => {
    const lines: string[] = []
    await createMailer({ from: 'x', providers: ['log'] }, { print: (line) => lines.push(line) }).send(message)
    expect(lines).toHaveLength(1)

    stubFetch(() => Response.json({ message: 'down' }, { status: 500 }))
    await createMailer(
      { from: 'x', providers: ['resend', 'log'], resend: { apiKey: 're_1' } },
      { print: (line) => lines.push(line) },
    ).send(message)
    expect(lines).toHaveLength(2)
  })
})
```

`packages/email/test/smtp.test.ts`:
```ts
import { createServer, type AddressInfo } from 'node:net'
import { SMTPServer } from 'smtp-server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { EmailError, createMailer, smtpMailer } from '../src/mailer'

interface Received {
  from: string
  to: string[]
  user: string | undefined
  raw: string
}

const received: Received[] = []
const server = new SMTPServer({
  authOptional: true,
  allowInsecureAuth: true,
  disabledCommands: ['STARTTLS'],
  onAuth(auth, _session, callback) {
    if (auth.username === 'mailer' && auth.password === 'secret') callback(null, { user: auth.username })
    else callback(new Error('Invalid username or password'))
  },
  onData(stream, session, callback) {
    let raw = ''
    stream.on('data', (chunk: Buffer) => (raw += chunk.toString()))
    stream.on('end', () => {
      received.push({
        from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
        to: session.envelope.rcptTo.map((r) => r.address),
        user: typeof session.user === 'string' ? session.user : undefined,
        raw,
      })
      callback()
    })
  },
})
let port = 0

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  port = (server.server.address() as AddressInfo).port
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))
afterEach(() => {
  received.length = 0
  vi.unstubAllGlobals()
})

const message = { to: 'sam@example.com', subject: 'Hello from SMTP', html: '<p>Hi</p>', text: 'Hi there' }

describe('smtpMailer', () => {
  it('delivers through an authenticated SMTP server', async () => {
    await smtpMailer('hi@replyooo.test', { host: '127.0.0.1', port, secure: false, user: 'mailer', pass: 'secret' }).send(message)
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ from: 'hi@replyooo.test', to: ['sam@example.com'], user: 'mailer' })
    expect(received[0]?.raw).toContain('Subject: Hello from SMTP')
    expect(received[0]?.raw).toContain('Hi there')
  })

  it('wraps connection failures in an EmailError', async () => {
    const closed = createServer()
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', () => resolve()))
    const deadPort = (closed.address() as AddressInfo).port
    await new Promise<void>((resolve) => closed.close(() => resolve()))

    const error = await smtpMailer('hi@replyooo.test', { host: '127.0.0.1', port: deadPort, secure: false })
      .send(message)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EmailError)
    expect((error as Error).message).toMatch(/^SMTP send failed: /)
  })

  it('falls back to SMTP when Resend is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: 'unavailable' }, { status: 503 })))
    const mailer = createMailer({
      from: 'hi@replyooo.test',
      providers: ['resend', 'smtp'],
      resend: { apiKey: 're_1' },
      smtp: { host: '127.0.0.1', port, secure: false },
    })
    await mailer.send(message)
    expect(received.map((r) => r.to)).toEqual([['sam@example.com']])
  })
})
```

- [ ] **Step 7: Run them to verify they fail**

Run: `pnpm --filter @replyooo/email exec vitest run test/resend.test.ts test/smtp.test.ts`
Expected: FAIL — `Cannot find module '../src/mailer'`.

- [ ] **Step 8: Implement `mailer.ts` and `testing.ts`**

`packages/email/src/mailer.ts`:
```ts
import nodemailer from 'nodemailer'
import type { EmailConfig, EmailProvider } from './config'

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>
}

export class EmailError extends Error {
  override name = 'EmailError'
}

const RESEND_URL = 'https://api.resend.com/emails'
const TIMEOUT_MS = 10_000

export function resendMailer(from: string, apiKey: string): Mailer {
  return {
    async send(message) {
      let response: Response
      try {
        response = await fetch(RESEND_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [message.to], subject: message.subject, html: message.html, text: message.text }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
      } catch (cause) {
        throw new EmailError(`Resend request failed: ${(cause as Error).message}`)
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string }
        throw new EmailError(`Resend rejected the email (${response.status}): ${body.message ?? response.statusText}`)
      }
    },
  }
}

export function smtpMailer(from: string, smtp: NonNullable<EmailConfig['smtp']>): Mailer {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.pass ?? '' } } : {}),
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  })
  return {
    async send(message) {
      try {
        await transport.sendMail({ from, to: message.to, subject: message.subject, html: message.html, text: message.text })
      } catch (cause) {
        throw new EmailError(`SMTP send failed: ${(cause as Error).message}`)
      }
    },
  }
}

/** Local development: prints the email (links included) instead of sending it. */
export function logMailer(print: (line: string) => void = (line) => console.info(line)): Mailer {
  return {
    async send(message) {
      print(`[email] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`)
    },
  }
}

/** Tries each mailer in order and stops at the first that accepts the message. */
export function failoverMailer(mailers: Mailer[]): Mailer {
  return {
    async send(message) {
      const errors: string[] = []
      for (const mailer of mailers) {
        try {
          await mailer.send(message)
          return
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error))
        }
      }
      throw new EmailError(`Every email provider failed: ${errors.join(' | ')}`)
    },
  }
}

function build(provider: EmailProvider, config: EmailConfig, print?: (line: string) => void): Mailer {
  switch (provider) {
    case 'resend':
      if (!config.resend) throw new Error('EMAIL_PROVIDER includes resend but RESEND_API_KEY is not set')
      return resendMailer(config.from, config.resend.apiKey)
    case 'smtp':
      if (!config.smtp) throw new Error('EMAIL_PROVIDER includes smtp but SMTP_HOST is not set')
      return smtpMailer(config.from, config.smtp)
    case 'log':
      return logMailer(print)
  }
}

export function createMailer(config: EmailConfig, options: { print?: (line: string) => void } = {}): Mailer {
  const mailers = config.providers.map((provider) => build(provider, config, options.print))
  const [only] = mailers
  return mailers.length === 1 && only ? only : failoverMailer(mailers)
}
```

`packages/email/src/testing.ts`:
```ts
import type { EmailMessage, Mailer } from './mailer'

/** Captures messages instead of sending them. `send` records synchronously, before its first await. */
export class RecordingMailer implements Mailer {
  sent: EmailMessage[] = []
  failWith: Error | null = null

  async send(message: EmailMessage): Promise<void> {
    if (this.failWith) throw this.failWith
    this.sent.push(message)
  }

  clear(): void {
    this.sent = []
  }
}
```

- [ ] **Step 9: Run the transport tests**

Run: `pnpm --filter @replyooo/email exec vitest run test/resend.test.ts test/smtp.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 10: Write the failing templates test**

`packages/email/test/templates.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { escapeHtml, invitationEmail, passwordResetEmail, reauthEmail, verificationEmail } from '../src/templates'

describe('templates', () => {
  it('escapes HTML in every interpolated value', () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;')
    const email = invitationEmail({ inviterName: '<script>alert(1)</script>', workspaceName: 'Acme & Co', url: 'https://app.test/signup?email=a%40b.c&x=1' })
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;')
    expect(email.html).toContain('Acme &amp; Co')
    expect(email.html).toContain('href="https://app.test/signup?email=a%40b.c&amp;x=1"')
  })

  it('puts the action link in the plain-text part', () => {
    const email = verificationEmail({ name: 'Sam', url: 'https://app.test/api/auth/verify-email?token=t' })
    expect(email.subject).toBe('Confirm your email for Replyooo')
    expect(email.text).toContain('Confirm email: https://app.test/api/auth/verify-email?token=t')
    expect(email.text).toContain('Hi Sam,')
  })

  it('has a subject for every email', () => {
    expect(passwordResetEmail({ name: 'Sam', url: 'u' }).subject).toBe('Reset your Replyooo password')
    expect(invitationEmail({ inviterName: 'Maya', workspaceName: 'Acme', url: 'u' }).subject).toBe('Maya invited you to Acme on Replyooo')
    expect(reauthEmail({ username: 'maya.makes', platform: 'instagram', workspaceName: 'Acme', url: 'u' }).subject).toBe(
      'Reconnect @maya.makes to keep your automations running',
    )
  })
})
```

- [ ] **Step 11: Run it to verify it fails**

Run: `pnpm --filter @replyooo/email exec vitest run test/templates.test.ts`
Expected: FAIL — `Cannot find module '../src/templates'`.

- [ ] **Step 12: Implement `templates.ts` and the index**

`packages/email/src/templates.ts`:
```ts
export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

interface Action {
  label: string
  url: string
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function html(heading: string, paragraphs: string[], action: Action, footer: string): string {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#3b3833">${escapeHtml(p)}</p>`)
    .join('')
  return `<!doctype html><html><body style="margin:0;background:#f6f3ee;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px"><tr><td style="padding:32px">
<div style="font-size:20px;font-weight:700;color:#141310;margin-bottom:24px">Replyooo</div>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;color:#141310">${escapeHtml(heading)}</h1>
${body}
<a href="${escapeHtml(action.url)}" style="display:inline-block;background:#ff4f1f;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:999px">${escapeHtml(action.label)}</a>
<p style="margin:24px 0 0;font-size:12.5px;line-height:1.5;color:#8a857c">${escapeHtml(footer)}</p>
</td></tr></table></td></tr></table></body></html>`
}

function text(heading: string, paragraphs: string[], action: Action, footer: string): string {
  return [heading, '', ...paragraphs.flatMap((p) => [p, '']), `${action.label}: ${action.url}`, '', footer].join('\n')
}

function render(subject: string, heading: string, paragraphs: string[], action: Action, footer: string): RenderedEmail {
  return { subject, html: html(heading, paragraphs, action, footer), text: text(heading, paragraphs, action, footer) }
}

export function verificationEmail({ name, url }: { name: string; url: string }): RenderedEmail {
  return render(
    'Confirm your email for Replyooo',
    'Confirm your email',
    [`Hi ${name},`, 'Confirm this address so teammates can invite you and we can reach you about your connected accounts.'],
    { label: 'Confirm email', url },
    'The link works for one hour. If you didn’t sign up for Replyooo, ignore this email.',
  )
}

export function passwordResetEmail({ name, url }: { name: string; url: string }): RenderedEmail {
  return render(
    'Reset your Replyooo password',
    'Reset your password',
    [`Hi ${name},`, 'Someone asked to reset the password for this Replyooo account. Choose a new one with the button below.'],
    { label: 'Choose a new password', url },
    'The link works for one hour. If you didn’t ask for this, ignore this email and your password stays the same.',
  )
}

export function invitationEmail({
  inviterName,
  workspaceName,
  url,
}: {
  inviterName: string
  workspaceName: string
  url: string
}): RenderedEmail {
  return render(
    `${inviterName} invited you to ${workspaceName} on Replyooo`,
    `Join ${workspaceName} on Replyooo`,
    [
      `${inviterName} invited you to the ${workspaceName} workspace on Replyooo.`,
      'Sign up or log in with this email address and confirm it. You’re added to the workspace automatically.',
    ],
    { label: 'Join the workspace', url },
    'If you weren’t expecting this, you can ignore this email.',
  )
}

export function reauthEmail({
  username,
  platform,
  workspaceName,
  url,
}: {
  username: string
  platform: 'instagram' | 'facebook'
  workspaceName: string
  url: string
}): RenderedEmail {
  const where = platform === 'instagram' ? 'Instagram account' : 'Facebook Page'
  return render(
    `Reconnect @${username} to keep your automations running`,
    'Meta needs you to reconnect',
    [
      `Meta revoked Replyooo’s access to the ${where} @${username} in ${workspaceName}.`,
      'Automations on this account are paused until you reconnect. It takes about a minute.',
    ],
    { label: 'Reconnect the account', url },
    'You’re getting this because you’re an owner or admin of this workspace.',
  )
}
```

`packages/email/src/index.ts`:
```ts
export * from './config'
export * from './mailer'
export * from './templates'
```

- [ ] **Step 13: Document the env**

Append to `.env.example`:
```bash

# ---------- email (web + worker) ----------
# Comma-separated, tried in order: resend, smtp, log (log prints emails, links included, to the console; refused in production)
EMAIL_PROVIDER=log
EMAIL_FROM="Replyooo <hello@example.com>"
RESEND_API_KEY=
SMTP_HOST=
SMTP_PORT=587
# Defaults to true only when SMTP_PORT is 465
SMTP_SECURE=
SMTP_USER=
SMTP_PASS=
```

- [ ] **Step 14: Run the package suite and typecheck**

Run: `pnpm --filter @replyooo/email exec vitest run && pnpm --filter @replyooo/email typecheck`
Expected: all 4 files PASS (17 tests), typecheck clean.

- [ ] **Step 15: Commit**

```bash
git add packages/email .env.example pnpm-lock.yaml
git commit -m "feat(email): add Resend, SMTP and log mailers with failover and templates"
```

---

### Task 2: Schema (Meta user id, Dodo event time, deletion requests), alert recipients, effective plan

**Files:**
- Modify: `packages/db/src/schema.ts`, `packages/db/src/index.ts`, `packages/shared/src/plans.ts`
- Create: `packages/db/src/queries.ts`, `packages/db/migrations/0003_meta_billing_email.sql` (generated)
- Test: `packages/db/test/queries.test.ts`, `packages/shared/test/plans.test.ts`

**Interfaces:**
- Consumes: existing schema.
- Produces:
  ```ts
  // @replyooo/db
  connectedAccounts.metaUserId: string | null        // column meta_user_id
  subscriptions.dodoEventAt: Date | null              // column dodo_event_at
  dataDeletionRequests: { id, confirmationCode, platform, metaUserId, accountsDeleted, createdAt }
  interface AccountAlertContext { username: string; platform: 'instagram' | 'facebook'; workspaceName: string; recipients: string[] }
  function accountAlertContext(db: Db | Tx, accountId: string): Promise<AccountAlertContext | null>
  // @replyooo/shared
  const PAID_STATUSES: readonly string[]               // ['active', 'past_due']
  const PLAN_NAMES: Record<PlanKey, string>
  interface SubscriptionState { plan: PlanKey; status: string; currentPeriodEnd: Date | null }
  function effectivePlan(subscription: SubscriptionState | null | undefined, now: Date): PlanKey
  ```

- [ ] **Step 1: Write the failing shared test**

Append to `packages/shared/test/plans.test.ts` (keep the existing imports; add `effectivePlan` and `PLAN_NAMES` to the import from `'../src/plans'`):
```ts
describe('effectivePlan', () => {
  const now = new Date('2026-10-06T10:00:00.000Z')
  const sub = (plan: 'free' | 'pro' | 'business', status: string, currentPeriodEnd: Date | null = null) => ({
    plan,
    status,
    currentPeriodEnd,
  })

  it('is free without a subscription', () => {
    expect(effectivePlan(null, now)).toBe('free')
    expect(effectivePlan(undefined, now)).toBe('free')
  })

  it('keeps a paid plan while active or past due', () => {
    expect(effectivePlan(sub('pro', 'active'), now)).toBe('pro')
    expect(effectivePlan(sub('business', 'past_due'), now)).toBe('business')
  })

  it('keeps a cancelled plan until the paid period ends', () => {
    expect(effectivePlan(sub('pro', 'cancelled', new Date('2026-10-20T00:00:00.000Z')), now)).toBe('pro')
    expect(effectivePlan(sub('pro', 'cancelled', new Date('2026-10-01T00:00:00.000Z')), now)).toBe('free')
    expect(effectivePlan(sub('pro', 'cancelled'), now)).toBe('free')
  })

  it('falls back to free when payment stopped', () => {
    for (const status of ['on_hold', 'paused', 'failed', 'expired', 'pending']) {
      expect(effectivePlan(sub('pro', status), now)).toBe('free')
    }
  })

  it('names every plan', () => {
    expect(PLAN_NAMES).toEqual({ free: 'Free', pro: 'Pro', business: 'Business' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @replyooo/shared exec vitest run test/plans.test.ts`
Expected: FAIL — `effectivePlan` is not exported.

- [ ] **Step 3: Implement in `packages/shared/src/plans.ts`**

Replace the comment on `PLAN_LIMITS` (`/** Launch numbers (spec §3.6). Enforcement lands with billing in Plan 4. */`) with:
```ts
/** Launch numbers (spec §3.6). The worker enforces contacts; the web enforces accounts and live automations. */
```
Append:
```ts
export const PLAN_NAMES: Record<PlanKey, string> = { free: 'Free', pro: 'Pro', business: 'Business' }

/** Dodo subscription statuses that keep a paid plan's limits (`past_due` is the payment-retry grace period). */
export const PAID_STATUSES: readonly string[] = ['active', 'past_due']

export interface SubscriptionState {
  plan: PlanKey
  status: string
  currentPeriodEnd: Date | null
}

/**
 * The plan whose limits apply now. A lapsed paid subscription falls back to free; a cancelled one
 * keeps its plan until the period it already paid for ends.
 */
export function effectivePlan(subscription: SubscriptionState | null | undefined, now: Date): PlanKey {
  if (!subscription || subscription.plan === 'free') return 'free'
  if (PAID_STATUSES.includes(subscription.status)) return subscription.plan
  if (subscription.status === 'cancelled' && subscription.currentPeriodEnd && subscription.currentPeriodEnd > now) {
    return subscription.plan
  }
  return 'free'
}
```

- [ ] **Step 4: Run the shared test**

Run: `pnpm --filter @replyooo/shared exec vitest run test/plans.test.ts`
Expected: PASS.

- [ ] **Step 5: Change the schema**

In `packages/db/src/schema.ts`:

In `connectedAccounts`, after `connectedByUserId: text('connected_by_user_id'),` add:
```ts
    /** The Meta user who granted access (app-scoped ID); Meta's deauthorize and data-deletion callbacks name this user. */
    metaUserId: text('meta_user_id'),
```
and change its index list to:
```ts
  (t) => [
    uniqueIndex('connected_accounts_platform_external_uq').on(t.platform, t.externalId),
    index('connected_accounts_meta_user_idx').on(t.platform, t.metaUserId),
  ],
```

In `subscriptions`, after `currentPeriodEnd: tz('current_period_end'),` add:
```ts
    /** `timestamp` of the last Dodo webhook applied; older events are ignored (webhooks can arrive out of order). */
    dodoEventAt: tz('dodo_event_at'),
```
and change its index list to:
```ts
  (t) => [
    uniqueIndex('subscriptions_workspace_uq').on(t.workspaceId),
    index('subscriptions_dodo_subscription_idx').on(t.dodoSubscriptionId),
    index('subscriptions_dodo_customer_idx').on(t.dodoCustomerId),
  ],
```

Append a new section at the end of the file:
```ts
// ---------- compliance ----------

/** Meta data-deletion callbacks (spec §5.3). The confirmation code is what Meta shows the person. */
export const dataDeletionRequests = pgTable(
  'data_deletion_requests',
  {
    id: id(),
    confirmationCode: text('confirmation_code').notNull(),
    platform: platformEnum('platform').notNull(),
    metaUserId: text('meta_user_id').notNull(),
    accountsDeleted: integer('accounts_deleted').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('data_deletion_requests_code_uq').on(t.confirmationCode)],
)
```

- [ ] **Step 6: Generate the migration**

Run: `pnpm --filter @replyooo/db db:generate --name meta_billing_email`
Expected: `packages/db/migrations/0003_meta_billing_email.sql` with `ALTER TABLE "connected_accounts" ADD COLUMN "meta_user_id" text`, `ALTER TABLE "subscriptions" ADD COLUMN "dodo_event_at" timestamp with time zone`, `CREATE TABLE "data_deletion_requests"` and the four new indexes. Read the SQL: it must only add (no drops or renames).

- [ ] **Step 7: Write the failing queries test**

`packages/db/test/queries.test.ts`:
```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../src'
import { accountAlertContext, authUsers, connectedAccounts, createDb, workspaceMembers, workspaces } from '../src'

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

async function member(workspaceId: string, role: 'owner' | 'admin' | 'member', email: string) {
  const id = randomUUID()
  await db.insert(authUsers).values({ id, name: email, email })
  await db.insert(workspaceMembers).values({ workspaceId, userId: id, role })
}

describe('accountAlertContext', () => {
  it('returns the account, its workspace and the owners’ and admins’ emails', async () => {
    const [workspace] = await db.insert(workspaces).values({ name: 'Acme', ownerUserId: 'x' }).returning()
    const workspaceId = workspace!.id
    const tag = randomUUID().slice(0, 8)
    await member(workspaceId, 'owner', `owner-${tag}@example.com`)
    await member(workspaceId, 'admin', `admin-${tag}@example.com`)
    await member(workspaceId, 'member', `member-${tag}@example.com`)
    const [account] = await db
      .insert(connectedAccounts)
      .values({ workspaceId, platform: 'instagram', externalId: `ig_${tag}`, username: 'maya.makes', accessTokenEnc: 'x' })
      .returning()

    expect(await accountAlertContext(db, account!.id)).toEqual({
      username: 'maya.makes',
      platform: 'instagram',
      workspaceName: 'Acme',
      recipients: [`admin-${tag}@example.com`, `owner-${tag}@example.com`],
    })
  })

  it('returns null for an unknown account', async () => {
    expect(await accountAlertContext(db, randomUUID())).toBeNull()
  })
})
```

- [ ] **Step 8: Run it to verify it fails**

Run: `pnpm --filter @replyooo/db exec vitest run test/queries.test.ts`
Expected: FAIL — `accountAlertContext` is not exported.

- [ ] **Step 9: Implement `queries.ts`**

`packages/db/src/queries.ts`:
```ts
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Db, Tx } from './client'
import { authUsers, connectedAccounts, workspaceMembers, workspaces } from './schema'

export interface AccountAlertContext {
  username: string
  platform: 'instagram' | 'facebook'
  workspaceName: string
  /** Owners' and admins' email addresses, sorted. */
  recipients: string[]
}

/** Who to tell when a connected account needs attention (spec §6: reauth → dashboard banner + email). */
export async function accountAlertContext(db: Db | Tx, accountId: string): Promise<AccountAlertContext | null> {
  const [account] = await db
    .select({
      username: connectedAccounts.username,
      platform: connectedAccounts.platform,
      workspaceId: connectedAccounts.workspaceId,
      workspaceName: workspaces.name,
    })
    .from(connectedAccounts)
    .innerJoin(workspaces, eq(workspaces.id, connectedAccounts.workspaceId))
    .where(eq(connectedAccounts.id, accountId))
  if (!account) return null
  const managers = await db
    .select({ email: authUsers.email })
    .from(workspaceMembers)
    .innerJoin(authUsers, eq(authUsers.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, account.workspaceId), inArray(workspaceMembers.role, ['owner', 'admin'])))
    .orderBy(asc(authUsers.email))
  return {
    username: account.username,
    platform: account.platform,
    workspaceName: account.workspaceName,
    recipients: managers.map((m) => m.email),
  }
}
```
`packages/db/src/index.ts` — add `export * from './queries'`.

- [ ] **Step 10: Run the db and shared suites, then everything that reads the schema**

Run: `pnpm --filter @replyooo/db exec vitest run && pnpm --filter @replyooo/shared exec vitest run && pnpm typecheck`
Expected: all PASS; typecheck clean in all packages.

- [ ] **Step 11: Commit**

```bash
git add packages/db packages/shared
git commit -m "feat(db): add Meta user id, Dodo event time, deletion requests and alert recipients"
```

---

### Task 3: Worker — stop starting runs past the monthly contact limit

**Files:**
- Create: `apps/worker/src/limits.ts`
- Modify: `apps/worker/src/inbound.ts`, `apps/worker/test/support.ts`
- Test: `apps/worker/test/inbound.test.ts`

**Interfaces:**
- Consumes: `effectivePlan`, `PLAN_LIMITS`, `usagePeriod` (shared); `subscriptions`, `usageCounters` (db).
- Produces: `mayStartRun(tx: Tx, workspaceId: string, contact: ContactRow, now: Date): Promise<boolean>`; test helper `seedUsage(db, workspaceId, contactsReached, subscription?)`.

- [ ] **Step 1: Add the seeding helper**

In `apps/worker/test/support.ts`, add `subscriptions` and `usageCounters` to the `@replyooo/db` import, add `import { usagePeriod } from '@replyooo/shared'` (merge with the existing shared type import if you prefer), and append:
```ts
export async function seedUsage(
  db: Db,
  workspaceId: string,
  contactsReached: number,
  subscription?: { plan: 'free' | 'pro' | 'business'; status?: string; currentPeriodEnd?: Date | null },
) {
  await db.insert(usageCounters).values({ workspaceId, period: usagePeriod(NOW), contactsReached })
  if (subscription) {
    await db.insert(subscriptions).values({
      workspaceId,
      plan: subscription.plan,
      status: subscription.status ?? 'active',
      currentPeriodEnd: subscription.currentPeriodEnd ?? null,
    })
  }
}
```

- [ ] **Step 2: Write the failing tests**

In `apps/worker/test/inbound.test.ts`, add `PLAN_LIMITS, usagePeriod` to the `@replyooo/shared` import, add `seedUsage` to the `./support` import, and append:
```ts
describe('plan limits', () => {
  const FREE_LIMIT = PLAN_LIMITS.free.contactsPerMonth

  it('starts no run for a new contact once the month’s contacts are used up', async () => {
    const { db, deps, jobs, account } = await setup()
    const { automation } = await publishAutomation(db, account, keywordFlow)
    await seedUsage(db, account.workspaceId, FREE_LIMIT)

    await handleInbound(deps, await insertEvent(db, dm(account, 'u-new', 'price please')))
    expect(jobs.flows).toEqual([])
    // The cooldown wasn't consumed, so the contact gets a run as soon as there's room again.
    expect(await db.select().from(automationEntries).where(eq(automationEntries.automationId, automation.id))).toEqual([])
    // The inbound message is still logged.
    expect(await db.select().from(messages).where(eq(messages.connectedAccountId, account.id))).toHaveLength(1)
  })

  it('keeps serving a contact already counted this month', async () => {
    const { db, deps, jobs, account } = await setup()
    await publishAutomation(db, account, keywordFlow)
    await seedContact(db, account, { platformUserId: 'u-known', lastCountedPeriod: usagePeriod(NOW) })
    await seedUsage(db, account.workspaceId, FREE_LIMIT)

    await handleInbound(deps, await insertEvent(db, dm(account, 'u-known', 'price please')))
    expect(jobs.flows).toHaveLength(1)
  })

  it('uses the paid plan’s limit while the subscription is active', async () => {
    const { db, deps, jobs, account } = await setup()
    await publishAutomation(db, account, keywordFlow)
    await seedUsage(db, account.workspaceId, FREE_LIMIT, { plan: 'pro' })

    await handleInbound(deps, await insertEvent(db, dm(account, 'u-pro', 'price please')))
    expect(jobs.flows).toHaveLength(1)
  })

  it('falls back to the free limit when the paid subscription is on hold', async () => {
    const { db, deps, jobs, account } = await setup()
    await publishAutomation(db, account, keywordFlow)
    await seedUsage(db, account.workspaceId, FREE_LIMIT, { plan: 'pro', status: 'on_hold' })

    await handleInbound(deps, await insertEvent(db, dm(account, 'u-hold', 'price please')))
    expect(jobs.flows).toEqual([])
  })

  it('lets a waiting run finish at the limit', async () => {
    const { db, deps, jobs, account } = await setup()
    const ask = await publishAutomation(db, account, askFlow)
    const contact = await seedContact(db, account, { platformUserId: 'u-waiting' })
    const run = await insertRun(db, { account, contact, ...ask }, {
      status: 'waiting',
      currentStepId: 'ask',
      wait: { kind: 'reply', attempts: 0 },
      waitUntil: new Date(NOW.getTime() + 86_400_000),
      stateVersion: 1,
    })
    await seedUsage(db, account.workspaceId, FREE_LIMIT)

    await handleInbound(deps, await insertEvent(db, dm(account, 'u-waiting', 'priya@gmail.com')))
    expect(jobs.flows).toEqual([{ data: { runId: run.id, event: { type: 'reply', text: 'priya@gmail.com' } } }])
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @replyooo/worker exec vitest run test/inbound.test.ts -t "plan limits"`
Expected: FAIL — the first and fourth tests get a flow job (no limit is enforced yet).

- [ ] **Step 4: Implement `limits.ts`**

`apps/worker/src/limits.ts`:
```ts
import type { Tx } from '@replyooo/db'
import { subscriptions, usageCounters } from '@replyooo/db'
import { effectivePlan, PLAN_LIMITS, usagePeriod } from '@replyooo/shared'
import { and, eq } from 'drizzle-orm'
import type { ContactRow } from './records'

/**
 * Spec §2.4: past the monthly contact limit no new runs start (in-flight runs finish). A contact
 * already counted this period costs nothing more, so it may still start runs.
 */
export async function mayStartRun(tx: Tx, workspaceId: string, contact: ContactRow, now: Date): Promise<boolean> {
  const period = usagePeriod(now)
  if (contact.lastCountedPeriod === period) return true
  const [subscription] = await tx
    .select({ plan: subscriptions.plan, status: subscriptions.status, currentPeriodEnd: subscriptions.currentPeriodEnd })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
  const [usage] = await tx
    .select({ contactsReached: usageCounters.contactsReached })
    .from(usageCounters)
    .where(and(eq(usageCounters.workspaceId, workspaceId), eq(usageCounters.period, period)))
  return (usage?.contactsReached ?? 0) < PLAN_LIMITS[effectivePlan(subscription, now)].contactsPerMonth
}
```

- [ ] **Step 5: Call it from `applyRoute`**

In `apps/worker/src/inbound.ts`:
- add `import type { Logger } from './logger'` and `import { mayStartRun } from './limits'`;
- add `log: Logger` to `interface ApplyContext`;
- in `processEvent`, change the call to `applyRoute(tx, { account, contact, route, candidates, event, now, log: deps.log })`;
- in `applyRoute`, directly after `if (!candidate) return null`, insert:
```ts
  if (!(await mayStartRun(tx, account.workspaceId, contact, now))) {
    ctx.log.info({ workspaceId: account.workspaceId, automationId: candidate.automationId }, 'monthly contact limit reached; run not started')
    return null
  }
```
(This runs before the `automationEntries` insert, so a blocked contact doesn't burn its 24h cooldown.)

- [ ] **Step 6: Run the worker suite**

Run: `pnpm --filter @replyooo/worker exec vitest run && pnpm --filter @replyooo/worker typecheck`
Expected: all PASS (65 tests), typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): stop starting runs past the plan's monthly contact limit"
```

---

### Task 4: Worker — email owners and admins when an account needs reauth

**Files:**
- Create: `apps/worker/src/alerts.ts`
- Modify: `apps/worker/package.json`, `apps/worker/src/env.ts`, `apps/worker/src/deps.ts`, `apps/worker/src/records.ts`, `apps/worker/src/outbound.ts`, `apps/worker/src/flow.ts`, `apps/worker/src/maintenance.ts`, `apps/worker/src/main.ts`, `apps/worker/test/support.ts`, `.env.example`
- Test: `apps/worker/test/alerts.test.ts`, `apps/worker/test/env.test.ts`, `apps/worker/test/outbound.test.ts`

**Interfaces:**
- Consumes: `Mailer`, `createMailer`, `parseEmailConfig`, `reauthEmail` (Task 1); `RecordingMailer` (`@replyooo/email/testing`); `accountAlertContext` (Task 2).
- Produces: `Deps.mailer: Mailer`, `Deps.appUrl: string`; `markReauthRequired(db, accountId): Promise<boolean>` (true only on the active → reauth_required transition); `flagReauth(deps, accountId): Promise<void>`; test helpers `TestContext.mailer: RecordingMailer` and `seedMember(db, workspaceId, role): Promise<string>` (returns the email).

- [ ] **Step 1: Add the dependency and env**

`apps/worker/package.json` → `"dependencies"`: add `"@replyooo/email": "workspace:*"`; then run `pnpm install`.

`apps/worker/src/env.ts` → add to `EnvSchema`:
```ts
  /** Public web origin, for links in emails (e.g. the reconnect link). */
  APP_URL: z.url(),
```
`apps/worker/test/env.test.ts` → add `APP_URL: 'http://localhost:3000',` to `required`, and add this test:
```ts
  it('requires the web origin for email links', () => {
    expect(() => loadEnv({ ...required, APP_URL: undefined })).toThrow()
  })
```

In `.env.example`, change the line above `APP_URL=http://localhost:3000` from `# ---------- web (copy into apps/web/.env.local) ----------` to keep it, and add a comment directly above `APP_URL`:
```bash
# Public web origin. The worker uses it too, for links in emails.
```

- [ ] **Step 2: Extend Deps and the test context**

`apps/worker/src/deps.ts`: add `import type { Mailer } from '@replyooo/email'` and to `interface Deps`:
```ts
  mailer: Mailer
  /** Public web origin (APP_URL), for links in emails. */
  appUrl: string
```

`apps/worker/test/support.ts`:
- add `import { RecordingMailer } from '@replyooo/email/testing'`, and `authUsers, workspaceMembers` to the `@replyooo/db` import;
- add `mailer: RecordingMailer` to `interface TestContext`;
- in `createTestContext`, create `const mailer = new RecordingMailer()` and add `mailer, appUrl: 'http://localhost:3000',` to the `deps` object (before `...overrides`); return `{ deps, jobs, adapters, clock, mailer }`. If `overrides.mailer` is passed, tests use their own instance;
- append:
```ts
/** A workspace member with a real user row; returns the member's email. */
export async function seedMember(db: Db, workspaceId: string, role: 'owner' | 'admin' | 'member'): Promise<string> {
  const id = randomUUID()
  const email = `${role}-${id}@example.com`
  await db.insert(authUsers).values({ id, name: role, email })
  await db.insert(workspaceMembers).values({ workspaceId, userId: id, role })
  return email
}
```

- [ ] **Step 3: Write the failing alert tests**

`apps/worker/test/alerts.test.ts`:
```ts
import { connectedAccounts } from '@replyooo/db'
import { RecordingMailer } from '@replyooo/email/testing'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { flagReauth } from '../src/alerts'
import { createTestContext, seedAccount, seedMember } from './support'

async function statusOf(db: ReturnType<typeof createTestContext>['deps']['db'], id: string) {
  const [row] = await db.select({ status: connectedAccounts.status }).from(connectedAccounts).where(eq(connectedAccounts.id, id))
  return row?.status
}

describe('flagReauth', () => {
  it('flags the account and emails owners and admins once', async () => {
    const { deps, mailer } = createTestContext()
    const { workspace, account } = await seedAccount(deps.db)
    const owner = await seedMember(deps.db, workspace.id, 'owner')
    const admin = await seedMember(deps.db, workspace.id, 'admin')
    await seedMember(deps.db, workspace.id, 'member')

    await flagReauth(deps, account.id)
    await flagReauth(deps, account.id)

    expect(await statusOf(deps.db, account.id)).toBe('reauth_required')
    expect(mailer.sent.map((m) => m.to).sort()).toEqual([admin, owner].sort())
    expect(mailer.sent[0]?.subject).toBe('Reconnect @acme to keep your automations running')
    expect(mailer.sent[0]?.text).toContain('http://localhost:3000/connect?platform=instagram')
  })

  it('does not email about an account that was already flagged or disconnected', async () => {
    const { deps, mailer } = createTestContext()
    const { workspace, account } = await seedAccount(deps.db)
    await seedMember(deps.db, workspace.id, 'owner')
    await deps.db.update(connectedAccounts).set({ status: 'disconnected' }).where(eq(connectedAccounts.id, account.id))

    await flagReauth(deps, account.id)
    expect(await statusOf(deps.db, account.id)).toBe('disconnected')
    expect(mailer.sent).toEqual([])
  })

  it('still flags the account when email is down', async () => {
    const mailer = new RecordingMailer()
    mailer.failWith = new Error('smtp down')
    const { deps } = createTestContext({ mailer })
    const { workspace, account } = await seedAccount(deps.db)
    await seedMember(deps.db, workspace.id, 'owner')

    await expect(flagReauth(deps, account.id)).resolves.toBeUndefined()
    expect(await statusOf(deps.db, account.id)).toBe('reauth_required')
  })
})
```

In `apps/worker/test/outbound.test.ts`, in `it('reauth errors flag the account and fail the run', …)`: destructure `mailer` from `setup()` (add `mailer: ctx.mailer` to `setup()`'s return object), call `await seedMember(db, account.workspaceId, 'owner')` before `handleOutbound`, and add at the end:
```ts
    expect(mailer.sent).toHaveLength(1)
```
(Add `seedMember` to that file's `./support` import.)

- [ ] **Step 4: Run them to verify they fail**

Run: `pnpm --filter @replyooo/worker exec vitest run test/alerts.test.ts test/outbound.test.ts test/env.test.ts`
Expected: FAIL — `Cannot find module '../src/alerts'`, and the outbound test sends no email.

- [ ] **Step 5: Implement**

`apps/worker/src/records.ts` → replace `markReauthRequired`:
```ts
/** Flags an active account. Returns false when it was already flagged or isn't active, so callers alert once. */
export async function markReauthRequired(db: Db | Tx, accountId: string): Promise<boolean> {
  const rows = await db
    .update(connectedAccounts)
    .set({ status: 'reauth_required' })
    .where(and(eq(connectedAccounts.id, accountId), eq(connectedAccounts.status, 'active')))
    .returning({ id: connectedAccounts.id })
  return rows.length > 0
}
```

`apps/worker/src/alerts.ts`:
```ts
import { accountAlertContext } from '@replyooo/db'
import { reauthEmail } from '@replyooo/email'
import type { Deps } from './deps'
import { markReauthRequired } from './records'

/**
 * Spec §6: a revoked token flags the account (its automations stop starting runs) and emails the
 * workspace's owners and admins, once per transition. Email failures are logged, never thrown.
 */
export async function flagReauth(deps: Pick<Deps, 'db' | 'mailer' | 'appUrl' | 'log'>, accountId: string): Promise<void> {
  if (!(await markReauthRequired(deps.db, accountId))) return
  try {
    const context = await accountAlertContext(deps.db, accountId)
    if (!context) return
    const url = new URL(`/connect?platform=${context.platform}`, deps.appUrl).toString()
    const email = reauthEmail({ username: context.username, platform: context.platform, workspaceName: context.workspaceName, url })
    const results = await Promise.allSettled(context.recipients.map((to) => deps.mailer.send({ to, ...email })))
    for (const result of results) {
      if (result.status === 'rejected') deps.log.warn({ err: result.reason, accountId }, 'reauth alert email failed')
    }
  } catch (error) {
    deps.log.warn({ err: error, accountId }, 'reauth alert failed')
  }
}
```

Replace the three call sites (and their imports of `markReauthRequired` with `import { flagReauth } from './alerts'`):
- `apps/worker/src/outbound.ts`: `if (error.kind === 'reauth') await markReauthRequired(db, account.id)` → `if (error.kind === 'reauth') await flagReauth(deps, account.id)`
- `apps/worker/src/flow.ts`: `if (error.kind === 'reauth') await markReauthRequired(deps.db, account.id)` → `if (error.kind === 'reauth') await flagReauth(deps, account.id)`
- `apps/worker/src/maintenance.ts`: `if (error instanceof MetaError && error.kind === 'reauth') await markReauthRequired(db, account.id)` → `if (error instanceof MetaError && error.kind === 'reauth') await flagReauth(deps, account.id)`

`apps/worker/src/main.ts`: add `import { createMailer, parseEmailConfig } from '@replyooo/email'`, and after `const log = …`:
```ts
const mailer = createMailer(parseEmailConfig(process.env), { print: (line) => log.info(line) })
```
then add `mailer, appUrl: env.APP_URL,` to the `deps` object.

- [ ] **Step 6: Run the worker suite**

Run: `pnpm --filter @replyooo/worker exec vitest run && pnpm --filter @replyooo/worker typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add apps/worker .env.example pnpm-lock.yaml
git commit -m "feat(worker): email owners and admins when an account needs reauth"
```

---

### Task 5: Web — email verification and password reset

**Files:**
- Create: `apps/web/src/lib/email.ts`, `apps/web/src/components/password-forms.tsx`, `apps/web/src/components/verify-banner.tsx`, `apps/web/src/app/(auth)/forgot-password/page.tsx`, `apps/web/src/app/(auth)/reset-password/page.tsx`
- Modify: `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/src/lib/env.ts`, `apps/web/src/lib/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/app/auth-actions.ts`, `apps/web/src/components/auth-form.tsx`, `apps/web/src/app/(auth)/login/page.tsx`, `apps/web/src/app/(app)/layout.tsx`, `apps/web/test/setup.ts`
- Test: `apps/web/test/auth.test.ts`

**Interfaces:**
- Consumes: `createMailer`, `parseEmailConfig`, `EmailMessage`, `Mailer`, `verificationEmail`, `passwordResetEmail` (Task 1); `RecordingMailer`.
- Produces:
  ```ts
  // lib/email.ts
  function mailer(): Mailer
  function setMailer(next: Mailer | undefined): void            // test seam
  function deliver(message: EmailMessage, via?: Mailer): void   // fire-and-forget, logs failures
  // lib/env.ts
  function appUrl(path: string): string                          // absolute URL on APP_URL
  // lib/auth.ts
  createAuth(options: { …existing…, mailer?: Mailer })
  // lib/session.ts
  const VERIFY_COOLDOWN_COOKIE = 'replyooo_verify_sent'
  // app/auth-actions.ts
  type FormState = { error?: string; notice?: string } | null
  function requestPasswordReset(state: FormState, formData: FormData): Promise<FormState>
  function resetPassword(state: FormState, formData: FormData): Promise<FormState>
  function resendVerification(): Promise<void>
  // components/auth-form.tsx
  export const authField: string
  AuthForm props += { notice?: string; email?: string }
  ```

- [ ] **Step 1: Wire the package into the web app**

`apps/web/package.json` → `"dependencies"`: add `"@replyooo/email": "workspace:*"`; run `pnpm install`.

`apps/web/next.config.ts`:
```ts
import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@replyooo/shared', '@replyooo/engine', '@replyooo/db', '@replyooo/meta', '@replyooo/email'],
  // nodemailer is CommonJS with optional native deps; load it from node_modules instead of bundling it.
  serverExternalPackages: ['nodemailer'],
}

export default config
```

`apps/web/src/lib/env.ts` → append:
```ts
/** An absolute URL on the app's public origin (links in emails, OAuth and billing return URLs). */
export function appUrl(path: string): string {
  return new URL(path, env().APP_URL).toString()
}
```

- [ ] **Step 2: Create `lib/email.ts`**

`apps/web/src/lib/email.ts`:
```ts
import 'server-only'
import { createMailer, type EmailMessage, type Mailer, parseEmailConfig } from '@replyooo/email'

const store = globalThis as { __replyoooMailer?: Mailer }

/** Built from the EMAIL_* env on first use (packages/email/src/config.ts). */
export function mailer(): Mailer {
  store.__replyoooMailer ??= createMailer(parseEmailConfig(process.env))
  return store.__replyoooMailer
}

/** Test seam: install a mailer, or pass undefined to rebuild from env on next use. */
export function setMailer(next: Mailer | undefined): void {
  store.__replyoooMailer = next
}

/**
 * Sends without blocking the caller. Email is best-effort: an outage never fails sign-up, an invite or a
 * reset request, and not awaiting keeps response times the same whether or not an address has an account.
 */
export function deliver(message: EmailMessage, via?: Mailer): void {
  let target: Mailer
  try {
    target = via ?? mailer()
  } catch (error) {
    console.error('email is not configured', { subject: message.subject, error })
    return
  }
  target.send(message).catch((error: unknown) => {
    console.error('email delivery failed', { to: message.to, subject: message.subject, error })
  })
}
```

`apps/web/test/setup.ts` → add at the top, with the other imports:
```ts
import { RecordingMailer } from '@replyooo/email/testing'
import { setMailer } from '@/lib/email'
```
and after the `process.env.*` assignments:
```ts
process.env.EMAIL_PROVIDER = 'log'
// No test sends real email; files that assert on email install their own RecordingMailer.
setMailer(new RecordingMailer())
```

- [ ] **Step 3: Write the failing auth tests**

In `apps/web/test/auth.test.ts`:
- change the imports to:
```ts
import { authUsers } from '@replyooo/db'
import { RecordingMailer } from '@replyooo/email/testing'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authErrorMessage, createAuth } from '@/lib/auth'
import { db } from '@/lib/db'
```
- replace the `const auth = createAuth({…})` block with:
```ts
const mailer = new RecordingMailer()
beforeEach(() => mailer.clear())

const auth = createAuth({
  db: db(),
  secret: 'test-secret-test-secret-test-secret-0000',
  baseURL: 'http://localhost:3000',
  mailer,
})

function linkIn(text: string): string {
  const match = text.match(/https?:\/\/\S+/)
  if (!match) throw new Error(`no link in: ${text}`)
  return match[0]
}

async function emailVerified(address: string) {
  const [user] = await db().select({ emailVerified: authUsers.emailVerified }).from(authUsers).where(eq(authUsers.email, address))
  return user?.emailVerified
}
```
- append:
```ts
describe('email verification', () => {
  it('emails a link on sign-up that verifies the address and signs the person in', async () => {
    const address = email()
    await auth.api.signUpEmail({
      body: { name: 'Verify Me', email: address, password: 'correct-horse', callbackURL: '/home?verified=1' },
    })
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]).toMatchObject({ to: address, subject: 'Confirm your email for Replyooo' })
    expect(await emailVerified(address)).toBe(false)

    const response = await auth.handler(new Request(linkIn(mailer.sent[0]?.text ?? '')))
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('/home?verified=1')
    expect(response.headers.getSetCookie().some((c) => c.startsWith('better-auth.session_token='))).toBe(true)
    expect(await emailVerified(address)).toBe(true)
  })

  it('still signs up when the email provider is down', async () => {
    const failing = new RecordingMailer()
    failing.failWith = new Error('provider down')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const flaky = createAuth({ db: db(), secret: 'test-secret-test-secret-test-secret-0000', baseURL: 'http://localhost:3000', mailer: failing })

    await expect(flaky.api.signUpEmail({ body: { name: 'Down', email: email(), password: 'correct-horse' } })).resolves.toBeTruthy()
    await vi.waitFor(() =>
      expect(errors).toHaveBeenCalledWith('email delivery failed', expect.objectContaining({ subject: 'Confirm your email for Replyooo' })),
    )
    errors.mockRestore()
  })
})

describe('password reset', () => {
  it('emails a reset link whose token sets a new password', async () => {
    const address = email()
    await auth.api.signUpEmail({ body: { name: 'Forgetful', email: address, password: 'correct-horse' } })
    mailer.clear()

    await auth.api.requestPasswordReset({ body: { email: address, redirectTo: 'http://localhost:3000/reset-password' } })
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]).toMatchObject({ to: address, subject: 'Reset your Replyooo password' })
    const token = new URL(linkIn(mailer.sent[0]?.text ?? '')).pathname.split('/').at(-1) ?? ''

    await auth.api.resetPassword({ body: { newPassword: 'battery-staple', token } })
    await expect(auth.api.signInEmail({ body: { email: address, password: 'battery-staple' } })).resolves.toBeTruthy()
    const error = await caught(auth.api.signInEmail({ body: { email: address, password: 'correct-horse' } }))
    expect(authErrorMessage(error)).toBe('Wrong email or password.')
  })

  it('answers the same for an unknown address and sends nothing', async () => {
    await expect(
      auth.api.requestPasswordReset({ body: { email: email(), redirectTo: 'http://localhost:3000/reset-password' } }),
    ).resolves.toBeTruthy()
    expect(mailer.sent).toEqual([])
  })

  it('explains an expired or reused token', async () => {
    const error = await caught(auth.api.resetPassword({ body: { newPassword: 'battery-staple', token: 'not-a-token' } }))
    expect(authErrorMessage(error)).toBe('That reset link has expired. Request a new one.')
  })
})
```
Also update the first existing test's expectation: sign-up now sends one verification email, which doesn't change its assertions.

- [ ] **Step 4: Run them to verify they fail**

Run: `pnpm --filter @replyooo/web exec vitest run test/auth.test.ts`
Expected: FAIL — no email recorded, `requestPasswordReset` rejects because `sendResetPassword` isn't configured, and the token message isn't mapped.

- [ ] **Step 5: Configure Better Auth**

`apps/web/src/lib/auth.ts`:
- add imports:
```ts
import { type EmailMessage, type Mailer, passwordResetEmail, verificationEmail } from '@replyooo/email'
import { deliver } from './email'
```
- add to the `createAuth` options type:
```ts
  /** Where auth emails go; defaults to the app mailer (lib/email.ts). */
  mailer?: Mailer
```
- at the top of `createAuth`, add `const send = (message: EmailMessage) => deliver(message, options.mailer)` and replace the `emailAndPassword` line with:
```ts
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => send({ to: user.email, ...passwordResetEmail({ name: user.name, url }) }),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => send({ to: user.email, ...verificationEmail({ name: user.name, url }) }),
    },
```
- in `authErrorMessage`, before the final `return`, add:
```ts
  if (code === 'INVALID_TOKEN') return 'That reset link has expired. Request a new one.'
```

- [ ] **Step 6: Run the auth tests**

Run: `pnpm --filter @replyooo/web exec vitest run test/auth.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 7: Add the actions**

`apps/web/src/lib/session.ts` → add below `WORKSPACE_COOKIE`:
```ts
/** Set for a minute after "Resend link" so the banner can't be used to spam an inbox. */
export const VERIFY_COOLDOWN_COOKIE = 'replyooo_verify_sent'
```

`apps/web/src/app/auth-actions.ts`:
- change the imports to:
```ts
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { auth, authErrorMessage } from '@/lib/auth'
import { appUrl } from '@/lib/env'
import { safeNext } from '@/lib/redirects'
import { COOKIE_OPTIONS, getSessionUser, VERIFY_COOLDOWN_COOKIE } from '@/lib/session'
```
- add below `AuthState`:
```ts
export type FormState = { error?: string; notice?: string } | null

/** Where Better Auth sends people after they click the verification link (autoSignInAfterVerification). */
const VERIFIED_CALLBACK = '/home?verified=1'
```
- in `signUp`, add `callbackURL: VERIFIED_CALLBACK,` to the `signUpEmail` body.
- append:
```ts
export async function requestPasswordReset(_state: FormState, formData: FormData): Promise<FormState> {
  const email = text(formData, 'email')
  if (!email) return { error: 'Enter your email address.' }
  try {
    await auth().api.requestPasswordReset({ body: { email, redirectTo: appUrl('/reset-password') }, headers: await headers() })
  } catch (error) {
    const message = authErrorMessage(error)
    if (message) return { error: message }
    throw error
  }
  // Same answer whether or not the address has an account.
  return { notice: 'If an account uses that address, we’ve emailed a link to reset the password. It works for one hour.' }
}

export async function resetPassword(_state: FormState, formData: FormData): Promise<FormState> {
  const password = String(formData.get('password') ?? '')
  if (password !== String(formData.get('confirm') ?? '')) return { error: 'The passwords don’t match.' }
  try {
    await auth().api.resetPassword({ body: { newPassword: password, token: text(formData, 'token') }, headers: await headers() })
  } catch (error) {
    const message = authErrorMessage(error)
    if (message) return { error: message }
    throw error
  }
  redirect('/login?reset=1')
}

export async function resendVerification(): Promise<void> {
  const user = await getSessionUser()
  if (!user || user.emailVerified) return
  const jar = await cookies()
  if (jar.has(VERIFY_COOLDOWN_COOKIE)) return
  await auth().api.sendVerificationEmail({ body: { email: user.email, callbackURL: VERIFIED_CALLBACK }, headers: await headers() })
  jar.set(VERIFY_COOLDOWN_COOKIE, '1', { ...COOKIE_OPTIONS, maxAge: 60 })
  revalidatePath('/', 'layout')
}
```

- [ ] **Step 8: Forms and pages**

`apps/web/src/components/auth-form.tsx`:
- rename `const field =` to `export const authField =` and update its uses in this file;
- add `notice?: string` and `email?: string` to the props (destructure them);
- in the `<input name="email" …>` add `defaultValue={email}`;
- directly under the `<p className="mt-1.5 …">` subtitle, add:
```tsx
      {notice && (
        <p role="status" className="mt-4 rounded-xl bg-white px-3.5 py-2.5 text-[13.5px] text-ink">
          {notice}
        </p>
      )}
```
- after the password `<input …/>`, add:
```tsx
        {!signup && (
          <Link href="/forgot-password" className="-mt-1 self-end text-[12.5px] font-medium text-muted hover:text-ink">
            Forgot password?
          </Link>
        )}
```

`apps/web/src/app/(auth)/login/page.tsx`:
```tsx
import type { Metadata } from 'next'
import { signIn, signInWithGoogle } from '@/app/auth-actions'
import { AuthForm } from '@/components/auth-form'
import { googleEnabled } from '@/lib/auth'

export const metadata: Metadata = { title: 'Log in' }

const NOTICES: Record<string, string> = { '1': 'Password updated. Log in with your new password.' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const { next, reset } = await searchParams
  return (
    <AuthForm
      mode="login"
      action={signIn}
      googleAction={googleEnabled() ? signInWithGoogle : undefined}
      next={next}
      notice={reset ? NOTICES[reset] : undefined}
    />
  )
}
```

`apps/web/src/components/password-forms.tsx`:
```tsx
'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { type FormState, requestPasswordReset, resetPassword } from '@/app/auth-actions'
import { authField } from './auth-form'
import { buttonClass, cx } from './ui'

function Message({ state }: { state: FormState }) {
  if (state?.error) {
    return (
      <p role="alert" className="text-[13px] font-medium text-[#c2330e]">
        {state.error}
      </p>
    )
  }
  if (state?.notice) {
    return (
      <p role="status" className="rounded-xl bg-white px-3.5 py-2.5 text-[13.5px] text-ink">
        {state.notice}
      </p>
    )
  }
  return null
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, null)
  return (
    <>
      <h1 className="font-display text-[34px] leading-tight font-bold tracking-[-0.04em]">Reset your password</h1>
      <p className="mt-1.5 text-[15px] text-muted">We’ll email you a link to choose a new one.</p>
      <form action={action} className="mt-8 flex flex-col gap-3">
        <input name="email" type="email" required placeholder="you@example.com" autoComplete="email" className={authField} />
        <Message state={state} />
        <button type="submit" disabled={pending} className={cx(buttonClass('primary'), 'mt-2 h-11 w-full', pending && 'opacity-60')}>
          Email me a link
        </button>
      </form>
      <p className="mt-6 text-center text-[13.5px] text-muted">
        Remembered it?{' '}
        <Link href="/login" className="font-semibold text-ink underline-offset-2 hover:underline">
          Log in
        </Link>
      </p>
    </>
  )
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPassword, null)
  return (
    <>
      <h1 className="font-display text-[34px] leading-tight font-bold tracking-[-0.04em]">Choose a new password</h1>
      <p className="mt-1.5 text-[15px] text-muted">You’ll be signed out everywhere else.</p>
      <form action={action} className="mt-8 flex flex-col gap-3">
        <input type="hidden" name="token" value={token} />
        <input name="password" type="password" required minLength={8} placeholder="New password" autoComplete="new-password" className={authField} />
        <input name="confirm" type="password" required minLength={8} placeholder="Repeat it" autoComplete="new-password" className={authField} />
        <Message state={state} />
        <button type="submit" disabled={pending} className={cx(buttonClass('primary'), 'mt-2 h-11 w-full', pending && 'opacity-60')}>
          Save password
        </button>
      </form>
    </>
  )
}
```

`apps/web/src/app/(auth)/forgot-password/page.tsx`:
```tsx
import type { Metadata } from 'next'
import { ForgotPasswordForm } from '@/components/password-forms'

export const metadata: Metadata = { title: 'Reset your password' }

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />
}
```

`apps/web/src/app/(auth)/reset-password/page.tsx`:
```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { ResetPasswordForm } from '@/components/password-forms'
import { buttonClass, cx } from '@/components/ui'

export const metadata: Metadata = { title: 'Choose a new password' }

/** Better Auth's /reset-password/:token redirects here with ?token=… or ?error=INVALID_TOKEN. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams
  if (token && !error) return <ResetPasswordForm token={token} />
  return (
    <>
      <h1 className="font-display text-[34px] leading-tight font-bold tracking-[-0.04em]">This link has expired</h1>
      <p className="mt-1.5 text-[15px] text-muted">Reset links work once, for one hour. Ask for a new one.</p>
      <Link href="/forgot-password" className={cx(buttonClass('primary'), 'mt-8 h-11 w-full')}>
        Send a new link
      </Link>
    </>
  )
}
```

`apps/web/src/components/verify-banner.tsx`:
```tsx
import { MailCheck } from 'lucide-react'
import { resendVerification } from '@/app/auth-actions'

export function VerifyEmailBanner({ email, sent }: { email: string; sent: boolean }) {
  return (
    <div className="flex items-center gap-2 border-b border-line bg-sky-soft px-10 py-2.5 text-[13.5px] text-ink">
      <MailCheck className="size-4" />
      Confirm your email. We sent a link to {email}.
      {sent ? (
        <span className="ml-auto text-muted">Sent. Check your inbox.</span>
      ) : (
        <form action={resendVerification} className="ml-auto">
          <button type="submit" className="font-semibold hover:underline">
            Resend link
          </button>
        </form>
      )}
    </div>
  )
}
```

`apps/web/src/app/(app)/layout.tsx`:
- add imports `import { cookies } from 'next/headers'`, `import { VerifyEmailBanner } from '@/components/verify-banner'` and add `VERIFY_COOLDOWN_COOKIE` to the `@/lib/session` import;
- after `const subscription = …`, add:
```tsx
  const verifyBanner = workspace.user.emailVerified ? null : (
    <VerifyEmailBanner email={workspace.user.email} sent={(await cookies()).has(VERIFY_COOLDOWN_COOKIE)} />
  )
```
- in the no-account branch render `{verifyBanner}` directly above `<main>{children}</main>`; in the main branch render `{verifyBanner}` as the first child of `<main className="min-w-0 flex-1">`.

- [ ] **Step 9: Run the web suite, typecheck and build**

Run: `pnpm --filter @replyooo/web exec vitest run && pnpm --filter @replyooo/web typecheck && pnpm --filter @replyooo/web build`
Expected: all PASS; the route list includes `/forgot-password` and `/reset-password`.

- [ ] **Step 10: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): verify emails and reset passwords through Better Auth"
```

---

### Task 6: Web — invitation emails

**Files:**
- Modify: `apps/web/src/lib/data/workspace.ts`, `apps/web/src/app/actions.ts`, `apps/web/src/app/(app)/settings/page.tsx`, `apps/web/src/app/(auth)/signup/page.tsx`
- Test: `apps/web/test/workspace-data.test.ts`

**Interfaces:**
- Consumes: `deliver`, `setMailer` (Task 5); `appUrl` (Task 5); `invitationEmail` (Task 1).
- Produces: `inviteMember(workspaceId: string, inviter: { id: string; name: string }, rawEmail: string): Promise<InviteResult>` (was `invitedByUserId: string`).

- [ ] **Step 1: Write the failing test**

In `apps/web/test/workspace-data.test.ts`:
- add imports `import { RecordingMailer } from '@replyooo/email/testing'` and `import { setMailer } from '@/lib/email'`;
- after the `mockFetch` lines add:
```ts
const mailer = new RecordingMailer()
beforeEach(() => {
  mailer.clear()
  setMailer(mailer)
})
```
- change every `inviteMember(x.workspaceId, x.user.id, …)` call to `inviteMember(x.workspaceId, x.user, …)` (the test users have `id` and `name`);
- append inside `describe('members and invitations', …)`:
```ts
  it('emails the invitee a sign-up link, and nobody else', async () => {
    const { workspaceId, user } = await createWorkspace('Mailroom')
    expect(await inviteMember(workspaceId, user, '  Sam@Example.com ')).toBe('invited')
    expect(await inviteMember(workspaceId, user, user.email)).toBe('member')
    expect(await inviteMember(workspaceId, user, 'nope')).toBe('invalid')

    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]).toMatchObject({ to: 'sam@example.com', subject: `${user.name} invited you to Mailroom on Replyooo` })
    expect(mailer.sent[0]?.text).toContain('http://localhost:3000/signup?email=sam%40example.com')
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @replyooo/web exec vitest run test/workspace-data.test.ts`
Expected: FAIL — typecheck error on the new argument shape, and no email recorded.

- [ ] **Step 3: Implement**

`apps/web/src/lib/data/workspace.ts`:
- add imports `import { invitationEmail } from '@replyooo/email'`, `import { deliver } from '../email'`, `import { appUrl } from '../env'`;
- replace `inviteMember`:
```ts
/** Saves a pending invite and emails it. It's accepted when someone with that verified email signs in (lib/workspaces.ts). */
export async function inviteMember(
  workspaceId: string,
  inviter: { id: string; name: string },
  rawEmail: string,
): Promise<InviteResult> {
  const email = rawEmail.trim().toLowerCase()
  if (!EMAIL.test(email)) return 'invalid'
  const [existing] = await db()
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .innerJoin(authUsers, eq(authUsers.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), sql`lower(${authUsers.email}) = ${email}`))
  if (existing) return 'member'
  await db().insert(workspaceInvitations).values({ workspaceId, email, invitedByUserId: inviter.id }).onConflictDoNothing()
  const [workspace] = await db().select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId))
  // Re-inviting an address re-sends the email.
  deliver({
    to: email,
    ...invitationEmail({
      inviterName: inviter.name,
      workspaceName: workspace?.name ?? 'a workspace',
      url: appUrl(`/signup?email=${encodeURIComponent(email)}`),
    }),
  })
  return 'invited'
}
```

`apps/web/src/app/actions.ts` → in `inviteMember`, change the data call to:
```ts
  const result = await data.inviteMember(workspace.workspaceId, workspace.user, String(formData.get('email') ?? ''))
```

`apps/web/src/app/(app)/settings/page.tsx` → change the `invited` notice to:
```ts
  invited: 'Invite sent. They join as soon as they sign in with that email address and confirm it.',
```

`apps/web/src/app/(auth)/signup/page.tsx` → read `email` from `searchParams` and pass it on (keep whatever else the page already passes):
```tsx
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams
  return <AuthForm mode="signup" action={signUp} googleAction={googleEnabled() ? signInWithGoogle : undefined} email={email} />
}
```

- [ ] **Step 4: Run the web suite and typecheck**

Run: `pnpm --filter @replyooo/web exec vitest run && pnpm --filter @replyooo/web typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): email workspace invitations"
```

---

### Task 7: Web — enforce connected-account and live-automation limits

**Files:**
- Create: `apps/web/src/lib/data/limits.ts`
- Modify: `apps/web/src/lib/data/types.ts`, `apps/web/src/lib/data/workspace.ts`, `apps/web/src/lib/data/automations.ts`, `apps/web/src/lib/connect.ts`, `apps/web/src/app/api/meta/oauth/[platform]/callback/route.ts`, `apps/web/src/app/connect/page.tsx`, `apps/web/src/app/(app)/settings/page.tsx`, `apps/web/src/app/(app)/layout.tsx`
- Test: `apps/web/test/limits.test.ts`, `apps/web/test/connect.test.ts`, `apps/web/test/workspace-data.test.ts`, `apps/web/test/ice-breakers.test.ts`

**Interfaces:**
- Consumes: `effectivePlan`, `PLAN_LIMITS`, `PLAN_NAMES` (Task 2).
- Produces:
  ```ts
  // lib/data/limits.ts
  function workspacePlan(executor: Db | Tx, workspaceId: string, now: Date, lock?: boolean): Promise<PlanKey>
  function liveAutomationBlock(tx: Tx, workspaceId: string, automation: { id: string; connectedAccountId: string }, replacesIceBreaker: boolean, now: Date): Promise<string | null>
  // lib/data/types.ts
  interface Subscription {
    plan: PlanKey             // effective plan (limits)
    billedPlan: PlanKey       // what the subscription row says
    status: string
    hasBillingAccount: boolean
    renewsAt: string | null   // ISO, Dodo next billing date
    contactsReached: number
    contactsLimit: number
    periodEnd: string         // ISO, when usage resets (1st of next UTC month)
  }
  // lib/connect.ts
  type ConnectError = … | 'plan_limit'
  type ConnectResult = { ok: true; accountIds: string[]; limited: boolean } | { ok: false; error: ConnectError }
  ```

- [ ] **Step 1: Write the failing tests**

`apps/web/test/limits.test.ts`:
```ts
import { automations, subscriptions } from '@replyooo/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as data from '@/lib/data/automations'
import { db } from '@/lib/db'
import { createAccount, createWorkspace } from './support'

async function workspaceWithLive(count: number) {
  const { workspaceId } = await createWorkspace('Limits')
  const account = await createAccount(workspaceId, 'instagram')
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const automation = await data.createAutomation(workspaceId, account.id, 'comment_to_dm')
    if (!automation) throw new Error('createAutomation returned null')
    expect(await data.publishAutomation(workspaceId, automation.id)).toMatchObject({ ok: true })
    ids.push(automation.id)
  }
  return { workspaceId, account, ids }
}

async function draft(workspaceId: string, accountId: string) {
  const automation = await data.createAutomation(workspaceId, accountId, 'comment_to_dm')
  if (!automation) throw new Error('createAutomation returned null')
  return automation
}

const FREE_MESSAGE = 'Your Free plan allows 3 live automations. Pause one or upgrade in Settings → Billing.'

describe('live automation limit', () => {
  it('refuses a fourth live automation on Free and writes nothing', async () => {
    const { workspaceId, account } = await workspaceWithLive(3)
    const fourth = await draft(workspaceId, account.id)
    expect(await data.publishAutomation(workspaceId, fourth.id)).toEqual({ ok: false, errors: [FREE_MESSAGE] })
    const [row] = await db().select().from(automations).where(eq(automations.id, fourth.id))
    expect(row).toMatchObject({ status: 'draft', currentVersionId: null })
  })

  it('still republishes an automation that is already live', async () => {
    const { workspaceId, ids } = await workspaceWithLive(3)
    expect(await data.publishAutomation(workspaceId, ids[0] ?? '')).toEqual({ ok: true, version: 2 })
  })

  it('refuses to resume a paused automation past the limit', async () => {
    const { workspaceId, account, ids } = await workspaceWithLive(3)
    expect(await data.setAutomationStatus(workspaceId, ids[0] ?? '', 'paused')).toEqual({ ok: true })
    const replacement = await draft(workspaceId, account.id)
    expect(await data.publishAutomation(workspaceId, replacement.id)).toMatchObject({ ok: true })
    expect(await data.setAutomationStatus(workspaceId, ids[0] ?? '', 'active')).toEqual({ ok: false, error: FREE_MESSAGE })
  })

  it('has no live limit on Pro', async () => {
    const { workspaceId, account } = await workspaceWithLive(3)
    await db().insert(subscriptions).values({ workspaceId, plan: 'pro', status: 'active' })
    expect(await data.publishAutomation(workspaceId, (await draft(workspaceId, account.id)).id)).toMatchObject({ ok: true })
  })
})
```

In `apps/web/test/ice-breakers.test.ts`, append inside `describe('publishing conversation starters', …)`:
```ts
  it('replacing the live conversation starter doesn’t count against the live limit', async () => {
    const { workspaceId, account } = await setup()
    messengerProfile(account.externalId)
    const first = await starters(workspaceId, account.id)
    await data.publishAutomation(workspaceId, first.id)
    for (let i = 0; i < 2; i++) {
      const other = await data.createAutomation(workspaceId, account.id, 'comment_to_dm')
      await data.publishAutomation(workspaceId, other?.id ?? '')
    }
    const second = await starters(workspaceId, account.id)
    expect(await data.publishAutomation(workspaceId, second.id)).toEqual({ ok: true, version: 1 })
  })
```

In `apps/web/test/connect.test.ts`:
- add `subscriptions` to the `@replyooo/db` import;
- in `'reconnecting refreshes the token and reactivates the same row'`, change the expected result to `{ ok: true, accountIds: [existing.id], limited: false }`;
- append inside `describe('connecting Instagram', …)`:
```ts
  it('refuses a second account on Free before subscribing webhooks', async () => {
    const { workspaceId, user } = await createWorkspace('FullIG')
    await createAccount(workspaceId, 'facebook', { externalId: `page_${randomUUID()}` })
    const subscribed = instagram()
    expect(await completeConnect(db(), 'instagram', workspaceId, user.id, 'CODE')).toEqual({ ok: false, error: 'plan_limit' })
    expect(subscribed).toEqual([])
  })

  it('a disconnected account doesn’t take a slot', async () => {
    const { workspaceId, user } = await createWorkspace('Slots')
    await createAccount(workspaceId, 'facebook', { externalId: `page_${randomUUID()}`, status: 'disconnected' })
    instagram()
    expect((await completeConnect(db(), 'instagram', workspaceId, user.id, 'CODE')).ok).toBe(true)
  })
```
- append inside `describe('connecting Facebook Pages', …)`:
```ts
  it('connects Pages up to the plan limit and reports the rest as limited', async () => {
    const { workspaceId, user } = await createWorkspace('ManyPages')
    const subscribed = facebook([
      { id: `page_${randomUUID()}`, name: 'One', access_token: 'P1' },
      { id: `page_${randomUUID()}`, name: 'Two', access_token: 'P2' },
    ])
    const result = await completeConnect(db(), 'facebook', workspaceId, user.id, 'FBCODE')
    expect(result).toMatchObject({ ok: true, limited: true })
    expect(result.ok && result.accountIds).toHaveLength(1)
    expect(subscribed).toHaveLength(1)

    await db().insert(subscriptions).values({ workspaceId, plan: 'pro', status: 'active' })
    facebook([{ id: `page_${randomUUID()}`, name: 'Three', access_token: 'P3' }])
    expect(await completeConnect(db(), 'facebook', workspaceId, user.id, 'FBCODE')).toMatchObject({ ok: true, limited: false })
  })

  it('reports plan_limit when no Page fits', async () => {
    const { workspaceId, user } = await createWorkspace('NoRoom')
    await createAccount(workspaceId, 'instagram')
    facebook([{ id: `page_${randomUUID()}`, name: 'One', access_token: 'P1' }])
    expect(await completeConnect(db(), 'facebook', workspaceId, user.id, 'FBCODE')).toEqual({ ok: false, error: 'plan_limit' })
  })
```

In `apps/web/test/workspace-data.test.ts`, replace `describe('getSubscription', …)` with:
```ts
describe('getSubscription', () => {
  const NOW = new Date('2026-10-06T10:00:00.000Z')

  it('reads the plan, this month’s usage and when usage resets', async () => {
    const { workspaceId } = await createWorkspace('Billing')
    await db().insert(subscriptions).values({
      workspaceId,
      plan: 'pro',
      dodoCustomerId: 'cus_1',
      currentPeriodEnd: new Date('2026-10-20T00:00:00.000Z'),
    })
    await db().insert(usageCounters).values([
      { workspaceId, period: '2026-10', contactsReached: 321 },
      { workspaceId, period: '2026-09', contactsReached: 999 },
    ])
    expect(await getSubscription(workspaceId, NOW)).toEqual({
      plan: 'pro',
      billedPlan: 'pro',
      status: 'active',
      hasBillingAccount: true,
      renewsAt: '2026-10-20T00:00:00.000Z',
      contactsReached: 321,
      contactsLimit: 5_000,
      periodEnd: '2026-11-01T00:00:00.000Z',
    })
  })

  it('uses free limits when a paid subscription is on hold', async () => {
    const { workspaceId } = await createWorkspace('Lapsed')
    await db().insert(subscriptions).values({ workspaceId, plan: 'business', status: 'on_hold' })
    expect(await getSubscription(workspaceId, NOW)).toMatchObject({ plan: 'free', billedPlan: 'business', status: 'on_hold', contactsLimit: 1_000 })
  })

  it('defaults to the free plan with no usage', async () => {
    const { workspaceId } = await createWorkspace('Fresh')
    expect(await getSubscription(workspaceId, NOW)).toMatchObject({
      plan: 'free',
      billedPlan: 'free',
      hasBillingAccount: false,
      renewsAt: null,
      contactsReached: 0,
      contactsLimit: 1_000,
    })
  })
})
```

If any existing web test publishes more than three automations in one workspace, give that workspace a Pro subscription at the start of the test (`db().insert(subscriptions).values({ workspaceId, plan: 'pro', status: 'active' })`) rather than weakening the limit.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @replyooo/web exec vitest run test/limits.test.ts test/connect.test.ts test/workspace-data.test.ts test/ice-breakers.test.ts`
Expected: FAIL — no limit enforced; `limited` missing from results; `getSubscription` lacks the new fields.

- [ ] **Step 3: Implement `limits.ts`**

`apps/web/src/lib/data/limits.ts`:
```ts
import 'server-only'
import { automations, type Db, subscriptions, type Tx } from '@replyooo/db'
import { effectivePlan, PLAN_LIMITS, PLAN_NAMES, type PlanKey } from '@replyooo/shared'
import { and, count, eq, ne, not } from 'drizzle-orm'

/** The plan whose limits apply now. `lock` serialises limit checks for one workspace inside a transaction. */
export async function workspacePlan(executor: Db | Tx, workspaceId: string, now: Date, lock = false): Promise<PlanKey> {
  const query = executor
    .select({ plan: subscriptions.plan, status: subscriptions.status, currentPeriodEnd: subscriptions.currentPeriodEnd })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
  const [row] = lock ? await query.for('update') : await query
  return effectivePlan(row, now)
}

/**
 * Spec §3.6 live-automation limit. Null when `automation` may go live, otherwise the message to show.
 * Publishing a conversation starter pauses the account's other live one, so that one isn't counted.
 */
export async function liveAutomationBlock(
  tx: Tx,
  workspaceId: string,
  automation: { id: string; connectedAccountId: string },
  replacesIceBreaker: boolean,
  now: Date,
): Promise<string | null> {
  const plan = await workspacePlan(tx, workspaceId, now, true)
  const limit = PLAN_LIMITS[plan].liveAutomations
  if (limit === null) return null
  const [row] = await tx
    .select({ live: count() })
    .from(automations)
    .where(
      and(
        eq(automations.workspaceId, workspaceId),
        eq(automations.status, 'active'),
        ne(automations.id, automation.id),
        replacesIceBreaker
          ? not(and(eq(automations.connectedAccountId, automation.connectedAccountId), eq(automations.triggerType, 'ice_breaker'))!)
          : undefined,
      ),
    )
  if ((row?.live ?? 0) < limit) return null
  return `Your ${PLAN_NAMES[plan]} plan allows ${limit} live automations. Pause one or upgrade in Settings → Billing.`
}
```

- [ ] **Step 4: Enforce on publish and resume**

`apps/web/src/lib/data/automations.ts`: add `import { liveAutomationBlock } from './limits'`.

In `publishAutomation`, directly after `const flow = parsed.data`, insert (before any write — returning from the transaction callback commits it):
```ts
      if (current.automation.status !== 'active') {
        const blocked = await liveAutomationBlock(tx, workspaceId, current.automation, flow.trigger.type === 'ice_breaker', new Date())
        if (blocked) return { ok: false, errors: [blocked] }
      }
```

In `setAutomationStatus`, directly after `const items = iceBreakerItems(id, row.live)`, insert:
```ts
      if (status === 'active') {
        const blocked = await liveAutomationBlock(tx, workspaceId, row.automation, items.length > 0, new Date())
        if (blocked) return { ok: false, error: blocked }
      }
```

- [ ] **Step 5: Effective plan in `getSubscription`**

`apps/web/src/lib/data/types.ts` → replace `interface Subscription` with:
```ts
export interface Subscription {
  /** The plan whose limits apply now (a lapsed paid plan counts as free). */
  plan: PlanKey
  /** The plan on the subscription row, paid or not. */
  billedPlan: PlanKey
  status: string
  /** A Dodo customer exists, so the customer portal can open. */
  hasBillingAccount: boolean
  /** Dodo's next billing date (ISO), when there is one. */
  renewsAt: string | null
  contactsReached: number
  contactsLimit: number
  /** When monthly usage resets: the 1st of next month, UTC (ISO). */
  periodEnd: string
}
```

`apps/web/src/lib/data/workspace.ts` → add `effectivePlan` to the `@replyooo/shared` import and replace `getSubscription`:
```ts
export async function getSubscription(workspaceId: string, now = new Date()): Promise<Subscription> {
  const [[subscription], [usage]] = await Promise.all([
    db()
      .select({
        plan: subscriptions.plan,
        status: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        dodoCustomerId: subscriptions.dodoCustomerId,
      })
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId)),
    db()
      .select({ contactsReached: usageCounters.contactsReached })
      .from(usageCounters)
      .where(and(eq(usageCounters.workspaceId, workspaceId), eq(usageCounters.period, usagePeriod(now)))),
  ])
  const plan = effectivePlan(subscription, now)
  return {
    plan,
    billedPlan: subscription?.plan ?? 'free',
    status: subscription?.status ?? 'active',
    hasBillingAccount: Boolean(subscription?.dodoCustomerId),
    renewsAt: subscription?.currentPeriodEnd?.toISOString() ?? null,
    contactsReached: usage?.contactsReached ?? 0,
    contactsLimit: PLAN_LIMITS[plan].contactsPerMonth,
    periodEnd: periodEnd(now).toISOString(),
  }
}
```

- [ ] **Step 6: Enforce on connect**

`apps/web/src/lib/connect.ts`:
- add `PLAN_LIMITS` to imports: `import { PLAN_LIMITS, type Platform } from '@replyooo/shared'` and `import { workspacePlan } from './data/limits'`;
- change the types:
```ts
export type ConnectError =
  | 'cancelled'
  | 'state_mismatch'
  | 'personal_account'
  | 'owned_elsewhere'
  | 'no_pages'
  | 'plan_limit'
  | 'meta_error'
/** `limited`: some granted Pages weren't connected because the plan's account limit was reached. */
export type ConnectResult = { ok: true; accountIds: string[]; limited: boolean } | { ok: false; error: ConnectError }
```
- add below `ownedElsewhere`:
```ts
/** Spec §3.6 connected-account limit. Reconnecting an account this workspace already has never needs a new slot. */
async function hasSlot(db: Db, workspaceId: string, platform: Platform, externalId: string): Promise<boolean> {
  const rows = await db
    .select({ platform: connectedAccounts.platform, externalId: connectedAccounts.externalId })
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.workspaceId, workspaceId), ne(connectedAccounts.status, 'disconnected')))
  if (rows.some((row) => row.platform === platform && row.externalId === externalId)) return true
  return rows.length < PLAN_LIMITS[await workspacePlan(db, workspaceId, new Date())].connectedAccounts
}
```
- in `connectInstagram`, after the `ownedElsewhere` line add:
```ts
  if (!(await hasSlot(db, workspaceId, 'instagram', connection.externalId))) return { ok: false, error: 'plan_limit' }
```
  and change the final return to `return id ? { ok: true, accountIds: [id], limited: false } : { ok: false, error: 'owned_elsewhere' }`;
- replace the body of `connectFacebook` after the `no_pages` check with:
```ts
  const accountIds: string[] = []
  let limited = false
  for (const page of pages) {
    if (await ownedElsewhere(db, workspaceId, 'facebook', page.externalId)) continue
    if (!(await hasSlot(db, workspaceId, 'facebook', page.externalId))) {
      limited = true
      continue
    }
    await adapterFor('facebook').subscribeWebhooks({ externalId: page.externalId, accessToken: page.accessToken })
    const id = await saveConnectedAccount(db, workspaceId, userId, { platform: 'facebook', ...page, expiresAt: null })
    if (id) accountIds.push(id)
  }
  if (accountIds.length > 0) return { ok: true, accountIds, limited }
  return { ok: false, error: limited ? 'plan_limit' : 'owned_elsewhere' }
```

`apps/web/src/app/api/meta/oauth/[platform]/callback/route.ts` → replace the last two lines (`if (first) …` and `redirect('/automations/new')`) with:
```ts
  if (first) jar.set(ACCOUNT_COOKIE, first, COOKIE_OPTIONS)
  redirect(result.limited ? '/settings?notice=account_limit#accounts' : '/automations/new')
```

`apps/web/src/app/connect/page.tsx` → add to `ERRORS`:
```ts
  plan_limit: 'Your plan’s connected-account limit is reached. Disconnect an account or upgrade in Settings → Billing.',
```

`apps/web/src/app/(app)/settings/page.tsx`:
- add below `INVITE_NOTICES`:
```ts
const NOTICES: Record<string, string> = {
  account_limit: 'Some Pages weren’t connected because your plan’s account limit is reached. Upgrade to connect more.',
}
```
- change the props to `searchParams: Promise<{ invite?: string; notice?: string }>`, destructure `notice: pageNotice`, and render under `<PageHeader … />`:
```tsx
      {pageNotice && NOTICES[pageNotice] && (
        <p role="status" className="mt-6 rounded-xl bg-brand-tint px-4 py-3 text-[13.5px] text-ink">
          {NOTICES[pageNotice]}
        </p>
      )}
```

`apps/web/src/app/(app)/layout.tsx` → in the main branch, directly after the reauth banner, add:
```tsx
        {subscription.contactsReached >= subscription.contactsLimit && (
          <div className="flex items-center gap-2 border-b border-[#ffd7c4] bg-brand-tint px-10 py-2.5 text-[13.5px] text-ink">
            <TriangleAlert className="size-4 text-brand" />
            You’ve reached {subscription.contactsLimit.toLocaleString('en-US')} contacts this month. New conversations are paused until{' '}
            {new Date(subscription.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
            <Link href="/settings#billing" className="ml-auto font-semibold text-brand hover:underline">
              Upgrade
            </Link>
          </div>
        )}
```

- [ ] **Step 7: Run the web suite, typecheck and build**

Run: `pnpm --filter @replyooo/web exec vitest run && pnpm --filter @replyooo/web typecheck && pnpm --filter @replyooo/web build`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): enforce connected-account and live-automation limits"
```

---

### Task 8: Dodo Payments webhook keeps `subscriptions` in sync

**Files:**
- Create: `apps/web/src/lib/billing/dodo.ts` (config + `planForProduct` only in this task), `apps/web/src/lib/billing/webhook.ts`, `apps/web/src/lib/billing/sync.ts`, `apps/web/src/app/api/webhooks/dodo/route.ts`
- Modify: `apps/web/src/lib/env.ts`, `.env.example`
- Test: `apps/web/test/billing-webhook.test.ts`

**Interfaces:**
- Consumes: `PAID_STATUSES` (Task 2); `subscriptions.dodoEventAt` (Task 2); `isUuid`.
- Produces:
  ```ts
  // lib/billing/dodo.ts
  type PaidPlan = 'pro' | 'business'
  interface DodoConfig { apiKey: string; baseUrl: string; products: Record<PaidPlan, string> }
  const DODO_BASE_URLS: { test_mode: string; live_mode: string }
  function dodoConfig(): DodoConfig | null
  function planForProduct(products: DodoConfig['products'], productId: string): PaidPlan | null
  // lib/billing/webhook.ts
  function verifyStandardWebhook(secret: string, headers: Headers, body: string, now?: Date): boolean
  // lib/billing/sync.ts
  type SyncResult = 'updated' | 'stale' | 'ignored' | 'unknown_product' | 'unknown_workspace'
  function applyDodoEvent(db: Db, products: DodoConfig['products'], payload: unknown): Promise<SyncResult>
  ```

- [ ] **Step 1: Env**

`apps/web/src/lib/env.ts` → add to `EnvSchema`:
```ts
  /** Dodo Payments (spec §3.6). Billing is disabled until the key and both product IDs are set. */
  DODO_API_KEY: optional,
  DODO_WEBHOOK_SECRET: optional,
  DODO_ENVIRONMENT: z.preprocess(blank, z.enum(['test_mode', 'live_mode']).default('test_mode')),
  DODO_PRODUCT_PRO: optional,
  DODO_PRODUCT_BUSINESS: optional,
```

`.env.example` → append:
```bash

# ---------- billing: Dodo Payments (web; optional until products exist) ----------
DODO_API_KEY=
# Webhook endpoint: <APP_URL>/api/webhooks/dodo, subscribe to subscription.* events
DODO_WEBHOOK_SECRET=
# test_mode or live_mode
DODO_ENVIRONMENT=test_mode
# Product IDs of the monthly subscription products; their prices must match apps/web/src/lib/plans.ts
DODO_PRODUCT_PRO=
DODO_PRODUCT_BUSINESS=
```

- [ ] **Step 2: Write the failing tests**

`apps/web/test/billing-webhook.test.ts`:
```ts
import { subscriptions } from '@replyooo/db'
import { eq } from 'drizzle-orm'
import { createHmac, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { POST } from '@/app/api/webhooks/dodo/route'
import { applyDodoEvent } from '@/lib/billing/sync'
import { verifyStandardWebhook } from '@/lib/billing/webhook'
import { getSubscription } from '@/lib/data/workspace'
import { db } from '@/lib/db'
import { createWorkspace } from './support'

const SECRET = `whsec_${Buffer.from('dodo-test-signing-key').toString('base64')}`
const PRODUCTS = { pro: 'pdt_pro', business: 'pdt_business' }

process.env.DODO_API_KEY = 'dodo_test_key'
process.env.DODO_WEBHOOK_SECRET = SECRET
process.env.DODO_PRODUCT_PRO = PRODUCTS.pro
process.env.DODO_PRODUCT_BUSINESS = PRODUCTS.business

function sign(body: string, id = `msg_${randomUUID()}`, timestamp = Math.floor(Date.now() / 1000)) {
  const key = Buffer.from(SECRET.slice('whsec_'.length), 'base64')
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
  return new Headers({ 'webhook-id': id, 'webhook-timestamp': String(timestamp), 'webhook-signature': `v1,${signature}` })
}

function event(
  type: string,
  timestamp: string,
  data: Partial<{ subscription_id: string; product_id: string; status: string; customer_id: string; next_billing_date: string | null; workspace_id: string }>,
) {
  return {
    business_id: 'bus_1',
    type,
    timestamp,
    data: {
      payload_type: 'Subscription',
      subscription_id: data.subscription_id ?? 'sub_1',
      product_id: data.product_id ?? PRODUCTS.pro,
      status: data.status ?? 'active',
      customer: { customer_id: data.customer_id ?? 'cus_1', email: 'owner@example.com', name: 'Owner' },
      next_billing_date: data.next_billing_date === undefined ? '2026-11-06T10:00:00.000Z' : data.next_billing_date,
      metadata: data.workspace_id ? { workspace_id: data.workspace_id } : {},
    },
  }
}

async function row(workspaceId: string) {
  const [subscription] = await db().select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId))
  return subscription
}

describe('verifyStandardWebhook', () => {
  it('accepts a valid signature among several and rejects tampering, old timestamps and wrong secrets', () => {
    const body = '{"type":"subscription.active"}'
    const headers = sign(body)
    expect(verifyStandardWebhook(SECRET, headers, body)).toBe(true)

    const many = new Headers(headers)
    many.set('webhook-signature', `v1,AAAA ${headers.get('webhook-signature')}`)
    expect(verifyStandardWebhook(SECRET, many, body)).toBe(true)

    expect(verifyStandardWebhook(SECRET, headers, `${body} `)).toBe(false)
    expect(verifyStandardWebhook(`whsec_${Buffer.from('other').toString('base64')}`, headers, body)).toBe(false)
    const old = sign(body, 'msg_old', Math.floor(Date.now() / 1000) - 600)
    expect(verifyStandardWebhook(SECRET, old, body)).toBe(false)
    expect(verifyStandardWebhook(SECRET, new Headers(), body)).toBe(false)
  })
})

describe('applyDodoEvent', () => {
  it('activates the plan from checkout metadata', async () => {
    const { workspaceId } = await createWorkspace('Buyer')
    const result = await applyDodoEvent(db(), PRODUCTS, event('subscription.active', '2026-10-06T10:00:00.000Z', { workspace_id: workspaceId, subscription_id: `sub_${workspaceId}` }))
    expect(result).toBe('updated')
    expect(await row(workspaceId)).toMatchObject({
      plan: 'pro',
      status: 'active',
      dodoCustomerId: 'cus_1',
      dodoSubscriptionId: `sub_${workspaceId}`,
      currentPeriodEnd: new Date('2026-11-06T10:00:00.000Z'),
    })
  })

  it('ignores an event older than the stored one', async () => {
    const { workspaceId } = await createWorkspace('Ordered')
    const sub = `sub_${workspaceId}`
    await applyDodoEvent(db(), PRODUCTS, event('subscription.renewed', '2026-10-06T10:00:00.000Z', { workspace_id: workspaceId, subscription_id: sub }))
    expect(
      await applyDodoEvent(db(), PRODUCTS, event('subscription.on_hold', '2026-10-05T10:00:00.000Z', { workspace_id: workspaceId, subscription_id: sub, status: 'on_hold' })),
    ).toBe('stale')
    expect(await row(workspaceId)).toMatchObject({ status: 'active' })
  })

  it('finds the workspace by subscription id when metadata is missing, and follows plan changes', async () => {
    const { workspaceId } = await createWorkspace('Upgrader')
    const sub = `sub_${workspaceId}`
    await applyDodoEvent(db(), PRODUCTS, event('subscription.active', '2026-10-06T10:00:00.000Z', { workspace_id: workspaceId, subscription_id: sub }))
    await applyDodoEvent(db(), PRODUCTS, event('subscription.plan_changed', '2026-10-07T10:00:00.000Z', { subscription_id: sub, product_id: PRODUCTS.business }))
    expect(await row(workspaceId)).toMatchObject({ plan: 'business' })
  })

  it('a lapsed payment drops the limits to free', async () => {
    const { workspaceId } = await createWorkspace('Lapse')
    const sub = `sub_${workspaceId}`
    await applyDodoEvent(db(), PRODUCTS, event('subscription.active', '2026-10-06T10:00:00.000Z', { workspace_id: workspaceId, subscription_id: sub }))
    await applyDodoEvent(db(), PRODUCTS, event('subscription.on_hold', '2026-10-08T10:00:00.000Z', { subscription_id: sub, status: 'on_hold' }))
    expect(await getSubscription(workspaceId, new Date('2026-10-08T12:00:00.000Z'))).toMatchObject({ plan: 'free', billedPlan: 'pro' })
  })

  it('an old subscription’s cancellation doesn’t override the newer active one', async () => {
    const { workspaceId } = await createWorkspace('Resubscriber')
    await applyDodoEvent(db(), PRODUCTS, event('subscription.active', '2026-10-06T10:00:00.000Z', { workspace_id: workspaceId, subscription_id: `new_${workspaceId}` }))
    expect(
      await applyDodoEvent(
        db(),
        PRODUCTS,
        event('subscription.cancelled', '2026-10-07T10:00:00.000Z', { workspace_id: workspaceId, subscription_id: `old_${workspaceId}`, status: 'cancelled' }),
      ),
    ).toBe('stale')
    expect(await row(workspaceId)).toMatchObject({ status: 'active', dodoSubscriptionId: `new_${workspaceId}` })
  })

  it('reports what it couldn’t apply', async () => {
    const { workspaceId } = await createWorkspace('Odd')
    expect(await applyDodoEvent(db(), PRODUCTS, event('subscription.active', '2026-10-06T10:00:00.000Z', { workspace_id: workspaceId, product_id: 'pdt_unknown' }))).toBe('unknown_product')
    expect(await applyDodoEvent(db(), PRODUCTS, event('subscription.active', '2026-10-06T10:00:00.000Z', { subscription_id: `sub_${randomUUID()}`, customer_id: `cus_${randomUUID()}` }))).toBe('unknown_workspace')
    expect(await applyDodoEvent(db(), PRODUCTS, { type: 'payment.succeeded', timestamp: '2026-10-06T10:00:00.000Z', data: { payload_type: 'Payment' } })).toBe('ignored')
  })
})

describe('POST /api/webhooks/dodo', () => {
  it('rejects a bad signature and applies a good one', async () => {
    const { workspaceId } = await createWorkspace('Route')
    const body = JSON.stringify(event('subscription.active', new Date().toISOString(), { workspace_id: workspaceId, subscription_id: `sub_${workspaceId}` }))

    const forged = await POST(new Request('http://localhost:3000/api/webhooks/dodo', { method: 'POST', body, headers: sign('{}') }))
    expect(forged.status).toBe(401)
    expect(await row(workspaceId)).toBeUndefined()

    const response = await POST(new Request('http://localhost:3000/api/webhooks/dodo', { method: 'POST', body, headers: sign(body) }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true, result: 'updated' })
    expect(await row(workspaceId)).toMatchObject({ plan: 'pro' })
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @replyooo/web exec vitest run test/billing-webhook.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/webhooks/dodo/route'`.

- [ ] **Step 4: Implement**

`apps/web/src/lib/billing/dodo.ts`:
```ts
import 'server-only'
import { env } from '../env'

export type PaidPlan = 'pro' | 'business'

export interface DodoConfig {
  apiKey: string
  baseUrl: string
  /** Dodo product ID per paid plan. */
  products: Record<PaidPlan, string>
}

export const DODO_BASE_URLS = {
  test_mode: 'https://test.dodopayments.com',
  live_mode: 'https://live.dodopayments.com',
} as const

/** Null until the API key and both product IDs are set; billing UI and endpoints stay off until then. */
export function dodoConfig(): DodoConfig | null {
  const e = env()
  if (!e.DODO_API_KEY || !e.DODO_PRODUCT_PRO || !e.DODO_PRODUCT_BUSINESS) return null
  return {
    apiKey: e.DODO_API_KEY,
    baseUrl: DODO_BASE_URLS[e.DODO_ENVIRONMENT],
    products: { pro: e.DODO_PRODUCT_PRO, business: e.DODO_PRODUCT_BUSINESS },
  }
}

export function planForProduct(products: DodoConfig['products'], productId: string): PaidPlan | null {
  if (productId === products.pro) return 'pro'
  if (productId === products.business) return 'business'
  return null
}
```

`apps/web/src/lib/billing/webhook.ts`:
```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

const TOLERANCE_SECONDS = 5 * 60

/**
 * Standard Webhooks (what Dodo Payments sends): HMAC-SHA256 over `${id}.${timestamp}.${body}` with the
 * base64 key after `whsec_`; the header may carry several space-separated `v1,<base64>` signatures.
 */
export function verifyStandardWebhook(secret: string, headers: Headers, body: string, now = new Date()): boolean {
  const id = headers.get('webhook-id')
  const timestamp = headers.get('webhook-timestamp')
  const signatures = headers.get('webhook-signature')
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return false
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest()
  return signatures.split(' ').some((entry) => {
    const [version, signature] = entry.split(',')
    if (version !== 'v1' || !signature) return false
    const given = Buffer.from(signature, 'base64')
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}
```

`apps/web/src/lib/billing/sync.ts`:
```ts
import 'server-only'
import { type Db, subscriptions, workspaces } from '@replyooo/db'
import { PAID_STATUSES } from '@replyooo/shared'
import { and, eq, isNull, lte, or } from 'drizzle-orm'
import { z } from 'zod'
import { isUuid } from '../data/ids'
import { type DodoConfig, planForProduct } from './dodo'

const SubscriptionEvent = z.object({
  type: z.string().startsWith('subscription.'),
  timestamp: z.iso.datetime({ offset: true }),
  data: z.object({
    payload_type: z.literal('Subscription'),
    subscription_id: z.string().min(1),
    product_id: z.string().min(1),
    status: z.string().min(1),
    customer: z.object({ customer_id: z.string().min(1) }),
    next_billing_date: z.string().nullish(),
    metadata: z.record(z.string(), z.unknown()).nullish(),
  }),
})
type SubscriptionData = z.infer<typeof SubscriptionEvent>['data']

export type SyncResult = 'updated' | 'stale' | 'ignored' | 'unknown_product' | 'unknown_workspace'

/** Checkout metadata first, then the subscription or customer we already stored. */
async function findWorkspace(db: Db, data: SubscriptionData): Promise<string | null> {
  const fromMetadata = data.metadata?.workspace_id
  if (typeof fromMetadata === 'string' && isUuid(fromMetadata)) {
    const [row] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, fromMetadata))
    if (row) return row.id
  }
  const [bySubscription] = await db
    .select({ workspaceId: subscriptions.workspaceId })
    .from(subscriptions)
    .where(eq(subscriptions.dodoSubscriptionId, data.subscription_id))
  if (bySubscription) return bySubscription.workspaceId
  const [byCustomer] = await db
    .select({ workspaceId: subscriptions.workspaceId })
    .from(subscriptions)
    .where(eq(subscriptions.dodoCustomerId, data.customer.customer_id))
  return byCustomer?.workspaceId ?? null
}

/**
 * Spec §5.3: Dodo `subscription.*` webhooks upsert the workspace's `subscriptions` row. Webhooks can
 * arrive out of order, so an event older than the last one applied is ignored, and a non-paying
 * event about a different subscription never replaces the one on file.
 */
export async function applyDodoEvent(db: Db, products: DodoConfig['products'], payload: unknown): Promise<SyncResult> {
  const parsed = SubscriptionEvent.safeParse(payload)
  if (!parsed.success) return 'ignored'
  const { data, timestamp } = parsed.data
  const plan = planForProduct(products, data.product_id)
  if (!plan) return 'unknown_product'
  const workspaceId = await findWorkspace(db, data)
  if (!workspaceId) return 'unknown_workspace'

  const eventAt = new Date(timestamp)
  const values = {
    plan,
    status: data.status,
    dodoCustomerId: data.customer.customer_id,
    dodoSubscriptionId: data.subscription_id,
    currentPeriodEnd: data.next_billing_date ? new Date(data.next_billing_date) : null,
    dodoEventAt: eventAt,
  }
  const fresh = or(isNull(subscriptions.dodoEventAt), lte(subscriptions.dodoEventAt, eventAt))
  const sameSubscription = or(isNull(subscriptions.dodoSubscriptionId), eq(subscriptions.dodoSubscriptionId, data.subscription_id))
  const rows = await db
    .insert(subscriptions)
    .values({ workspaceId, ...values })
    .onConflictDoUpdate({
      target: subscriptions.workspaceId,
      set: values,
      setWhere: PAID_STATUSES.includes(data.status) ? fresh : and(fresh, sameSubscription),
    })
    .returning({ id: subscriptions.id })
  return rows.length > 0 ? 'updated' : 'stale'
}
```

`apps/web/src/app/api/webhooks/dodo/route.ts`:
```ts
import { applyDodoEvent } from '@/lib/billing/sync'
import { dodoConfig } from '@/lib/billing/dodo'
import { verifyStandardWebhook } from '@/lib/billing/webhook'
import { db } from '@/lib/db'
import { env } from '@/lib/env'

/** Dodo Payments webhooks (spec §5.3). Signed; unknown events are acknowledged so Dodo stops retrying them. */
export async function POST(request: Request) {
  const secret = env().DODO_WEBHOOK_SECRET
  const config = dodoConfig()
  if (!secret || !config) return new Response('Billing is not configured', { status: 404 })
  const body = await request.text()
  if (!verifyStandardWebhook(secret, request.headers, body)) return new Response('Invalid signature', { status: 401 })
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }
  const result = await applyDodoEvent(db(), config.products, payload)
  if (result === 'unknown_product' || result === 'unknown_workspace') {
    console.warn('dodo webhook not applied', { result, id: request.headers.get('webhook-id') })
  }
  return Response.json({ received: true, result })
}
```

- [ ] **Step 5: Run the test, the suite and typecheck**

Run: `pnpm --filter @replyooo/web exec vitest run && pnpm --filter @replyooo/web typecheck`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web .env.example
git commit -m "feat(web): sync subscriptions from signed Dodo Payments webhooks"
```

---

### Task 9: Checkout, plan changes and the customer portal in Settings → Billing

**Files:**
- Create: `apps/web/src/lib/billing/checkout.ts`, `apps/web/src/lib/plans.ts`
- Modify: `apps/web/src/lib/billing/dodo.ts`, `apps/web/src/app/actions.ts`, `apps/web/src/app/(app)/settings/page.tsx`
- Test: `apps/web/test/billing.test.ts`, `apps/web/test/plans.test.ts`

**Interfaces:**
- Consumes: `DodoConfig`, `dodoConfig` (Task 8); `effectivePlan`, `PLAN_LIMITS`, `PLAN_NAMES` (Task 2); `Subscription` (Task 7); `appUrl` (Task 5).
- Produces:
  ```ts
  // lib/billing/dodo.ts (added)
  class DodoError extends Error { status: number }
  function createCheckout(config: DodoConfig, input: { productId: string; workspaceId: string; customer: { customerId: string } | { email: string; name: string }; returnUrl: string }): Promise<string>
  function changeSubscriptionPlan(config: DodoConfig, subscriptionId: string, productId: string): Promise<string | null>
  function createPortalSession(config: DodoConfig, customerId: string, returnUrl: string): Promise<string>
  // lib/billing/checkout.ts
  function startPlanChange(config: DodoConfig, workspace: { workspaceId: string; user: { email: string; name: string } }, plan: PaidPlan, now?: Date): Promise<string>
  function billingCustomer(workspaceId: string): Promise<string | null>
  // lib/plans.ts
  interface PlanDisplay { key: PlanKey; name: string; price: string; blurb: string; perks: string[]; featured: boolean }
  const PLAN_CATALOG: PlanDisplay[]
  // app/actions.ts
  function switchPlan(formData: FormData): Promise<void>     // owner/admin
  function openBillingPortal(): Promise<void>                // owner/admin
  ```

- [ ] **Step 1: Write the failing tests**

`apps/web/test/plans.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { PLAN_CATALOG } from '@/lib/plans'

describe('PLAN_CATALOG', () => {
  it('derives each plan’s limits from PLAN_LIMITS', () => {
    expect(PLAN_CATALOG.map((plan) => [plan.key, plan.name, plan.price])).toEqual([
      ['free', 'Free', '$0'],
      ['pro', 'Pro', '$12'],
      ['business', 'Business', '$29'],
    ])
    expect(PLAN_CATALOG[0]?.perks.slice(0, 3)).toEqual(['1,000 contacts / month', '1 connected account', '3 live automations'])
    expect(PLAN_CATALOG[1]?.perks.slice(0, 3)).toEqual(['5,000 contacts / month', '3 connected accounts', 'Unlimited live automations'])
    expect(PLAN_CATALOG.filter((plan) => plan.featured).map((plan) => plan.key)).toEqual(['pro'])
  })
})
```

`apps/web/test/billing.test.ts`:
```ts
import { subscriptions } from '@replyooo/db'
import { http, HttpResponse } from 'msw'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { startPlanChange } from '@/lib/billing/checkout'
import { createPortalSession, DodoError, type DodoConfig } from '@/lib/billing/dodo'
import { db } from '@/lib/db'
import { createWorkspace, mockFetch } from './support'

const server = mockFetch()
beforeEach(() => server.reset())
afterAll(() => server.restore())

const DODO = 'https://test.dodopayments.com'
const config: DodoConfig = { apiKey: 'dodo_key', baseUrl: DODO, products: { pro: 'pdt_pro', business: 'pdt_business' } }
const RETURN = 'http://localhost:3000/settings?billing=updated#billing'

function capture(method: 'post', path: string, response: unknown) {
  const calls: { url: string; auth: string | null; body: unknown }[] = []
  server.use(
    http[method](`${DODO}${path}`, async ({ request }) => {
      const text = await request.text()
      calls.push({ url: request.url, auth: request.headers.get('authorization'), body: text ? JSON.parse(text) : null })
      return HttpResponse.json(response)
    }),
  )
  return calls
}

async function owner(name: string) {
  const { workspaceId, user } = await createWorkspace(name)
  return { workspaceId, user: { email: user.email, name: user.name } }
}

describe('startPlanChange', () => {
  it('starts a checkout for a workspace without a paid subscription', async () => {
    const workspace = await owner('Checkout')
    const calls = capture('post', '/checkouts', { session_id: 'cks_1', checkout_url: 'https://checkout.dodopayments.com/cks_1' })

    expect(await startPlanChange(config, workspace, 'pro')).toBe('https://checkout.dodopayments.com/cks_1')
    expect(calls).toEqual([
      {
        url: `${DODO}/checkouts`,
        auth: 'Bearer dodo_key',
        body: {
          product_cart: [{ product_id: 'pdt_pro', quantity: 1 }],
          customer: { email: workspace.user.email, name: workspace.user.name },
          return_url: RETURN,
          metadata: { workspace_id: workspace.workspaceId },
        },
      },
    ])
  })

  it('reuses the Dodo customer of a lapsed subscription', async () => {
    const workspace = await owner('Returning')
    await db().insert(subscriptions).values({ workspaceId: workspace.workspaceId, plan: 'pro', status: 'expired', dodoCustomerId: 'cus_9', dodoSubscriptionId: 'sub_9' })
    const calls = capture('post', '/checkouts', { session_id: 'cks_2', checkout_url: 'https://checkout.dodopayments.com/cks_2' })

    await startPlanChange(config, workspace, 'business')
    expect(calls[0]?.body).toMatchObject({ customer: { customer_id: 'cus_9' }, product_cart: [{ product_id: 'pdt_business', quantity: 1 }] })
  })

  it('changes an active subscription in place', async () => {
    const workspace = await owner('Upgrade')
    await db().insert(subscriptions).values({ workspaceId: workspace.workspaceId, plan: 'pro', status: 'active', dodoCustomerId: 'cus_1', dodoSubscriptionId: 'sub_1' })
    const calls = capture('post', '/subscriptions/sub_1/change-plan', { payment_link: null })

    expect(await startPlanChange(config, workspace, 'business')).toBe(RETURN)
    expect(calls[0]?.body).toEqual({ product_id: 'pdt_business', quantity: 1, proration_billing_mode: 'prorated_immediately' })
  })

  it('sends the customer to Dodo when the change needs a payment', async () => {
    const workspace = await owner('PayDiff')
    await db().insert(subscriptions).values({ workspaceId: workspace.workspaceId, plan: 'pro', status: 'active', dodoCustomerId: 'cus_2', dodoSubscriptionId: 'sub_2' })
    capture('post', '/subscriptions/sub_2/change-plan', { payment_link: 'https://checkout.dodopayments.com/pay_1' })
    expect(await startPlanChange(config, workspace, 'business')).toBe('https://checkout.dodopayments.com/pay_1')
  })

  it('does nothing for the plan the workspace already pays for', async () => {
    const workspace = await owner('Same')
    await db().insert(subscriptions).values({ workspaceId: workspace.workspaceId, plan: 'pro', status: 'active', dodoCustomerId: 'cus_3', dodoSubscriptionId: 'sub_3' })
    expect(await startPlanChange(config, workspace, 'pro')).toBe(RETURN)
  })
})

describe('createPortalSession', () => {
  it('returns the portal link with our return URL', async () => {
    const calls = capture('post', '/customers/cus_1/customer-portal/session', { link: 'https://customer.dodopayments.com/s_1' })
    expect(await createPortalSession(config, 'cus_1', 'http://localhost:3000/settings#billing')).toBe('https://customer.dodopayments.com/s_1')
    expect(new URL(calls[0]?.url ?? '').searchParams.get('return_url')).toBe('http://localhost:3000/settings#billing')
  })

  it('turns Dodo errors into DodoError', async () => {
    server.use(http.post(`${DODO}/customers/cus_x/customer-portal/session`, () => HttpResponse.json({ message: 'Customer not found' }, { status: 404 })))
    const error = await createPortalSession(config, 'cus_x', 'http://localhost:3000/settings').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DodoError)
    expect(error).toMatchObject({ status: 404, message: 'Dodo POST /customers/cus_x/customer-portal/session failed (404): Customer not found' })
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @replyooo/web exec vitest run test/billing.test.ts test/plans.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement the client, checkout and catalog**

Append to `apps/web/src/lib/billing/dodo.ts`:
```ts
export class DodoError extends Error {
  override name = 'DodoError'
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function post<T>(config: DodoConfig, path: string, init: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
  const url = new URL(path, config.baseUrl)
  for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (cause) {
    throw new DodoError(`Dodo request failed: ${(cause as Error).message}`, 0)
  }
  const body = (await response.json().catch(() => ({}))) as { message?: string }
  if (!response.ok) {
    throw new DodoError(`Dodo POST ${path} failed (${response.status}): ${body.message ?? response.statusText}`, response.status)
  }
  return body as T
}

/** A hosted checkout for a new subscription. The workspace id rides along as metadata for the webhook. */
export async function createCheckout(
  config: DodoConfig,
  input: {
    productId: string
    workspaceId: string
    customer: { customerId: string } | { email: string; name: string }
    returnUrl: string
  },
): Promise<string> {
  const customer = 'customerId' in input.customer
    ? { customer_id: input.customer.customerId }
    : { email: input.customer.email, name: input.customer.name }
  const session = await post<{ checkout_url?: string | null }>(config, '/checkouts', {
    body: {
      product_cart: [{ product_id: input.productId, quantity: 1 }],
      customer,
      return_url: input.returnUrl,
      metadata: { workspace_id: input.workspaceId },
    },
  })
  if (!session.checkout_url) throw new DodoError('Dodo returned no checkout URL', 200)
  return session.checkout_url
}

/** Moves an existing subscription to another product. Returns a payment link when the change needs one. */
export async function changeSubscriptionPlan(config: DodoConfig, subscriptionId: string, productId: string): Promise<string | null> {
  const result = await post<{ payment_link?: string | null }>(config, `/subscriptions/${encodeURIComponent(subscriptionId)}/change-plan`, {
    body: { product_id: productId, quantity: 1, proration_billing_mode: 'prorated_immediately' },
  })
  return result.payment_link ?? null
}

/** Dodo's hosted customer portal: payment method, invoices, cancellation. */
export async function createPortalSession(config: DodoConfig, customerId: string, returnUrl: string): Promise<string> {
  const result = await post<{ link: string }>(config, `/customers/${encodeURIComponent(customerId)}/customer-portal/session`, {
    query: { return_url: returnUrl },
  })
  return result.link
}
```

`apps/web/src/lib/billing/checkout.ts`:
```ts
import 'server-only'
import { subscriptions } from '@replyooo/db'
import { effectivePlan } from '@replyooo/shared'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { appUrl } from '../env'
import { changeSubscriptionPlan, createCheckout, type DodoConfig, type PaidPlan } from './dodo'

/**
 * Where to send the browser to move a workspace to `plan`. One subscription per workspace: a live paid
 * subscription changes plan in place; anything else (free, lapsed) gets a new checkout.
 */
export async function startPlanChange(
  config: DodoConfig,
  workspace: { workspaceId: string; user: { email: string; name: string } },
  plan: PaidPlan,
  now = new Date(),
): Promise<string> {
  const returnUrl = appUrl('/settings?billing=updated#billing')
  const [current] = await db().select().from(subscriptions).where(eq(subscriptions.workspaceId, workspace.workspaceId))
  if (current?.dodoSubscriptionId && effectivePlan(current, now) !== 'free') {
    if (current.plan === plan) return returnUrl
    return (await changeSubscriptionPlan(config, current.dodoSubscriptionId, config.products[plan])) ?? returnUrl
  }
  return createCheckout(config, {
    productId: config.products[plan],
    workspaceId: workspace.workspaceId,
    customer: current?.dodoCustomerId ? { customerId: current.dodoCustomerId } : { email: workspace.user.email, name: workspace.user.name },
    returnUrl,
  })
}

export async function billingCustomer(workspaceId: string): Promise<string | null> {
  const [row] = await db()
    .select({ customerId: subscriptions.dodoCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
  return row?.customerId ?? null
}
```

`apps/web/src/lib/plans.ts`:
```ts
import { PLAN_LIMITS, PLAN_NAMES, type PlanKey } from '@replyooo/shared'

export interface PlanDisplay {
  key: PlanKey
  name: string
  price: string
  blurb: string
  perks: string[]
  featured: boolean
}

const count = new Intl.NumberFormat('en-US')

const COPY: Record<PlanKey, { price: string; blurb: string; extras: string[]; featured: boolean }> = {
  free: { price: '$0', blurb: 'For trying it on your next reel.', extras: ['Comment & story automations', 'Replyooo branding'], featured: false },
  pro: { price: '$12', blurb: 'For creators who post every week and want the funnel.', extras: ['Follow gate & lead capture', 'No branding'], featured: true },
  business: { price: '$29', blurb: 'For full-time creators, teams and brands.', extras: ['Team members', 'Priority support'], featured: false },
}

function limitPerks(key: PlanKey): string[] {
  const limits = PLAN_LIMITS[key]
  return [
    `${count.format(limits.contactsPerMonth)} contacts / month`,
    limits.connectedAccounts === 1 ? '1 connected account' : `${limits.connectedAccounts} connected accounts`,
    limits.liveAutomations === null ? 'Unlimited live automations' : `${limits.liveAutomations} live automations`,
  ]
}

/** One source for the landing page, /pricing and Settings → Billing. Prices must match the Dodo products. */
export const PLAN_CATALOG: PlanDisplay[] = (['free', 'pro', 'business'] as const).map((key) => ({
  key,
  name: PLAN_NAMES[key],
  price: COPY[key].price,
  blurb: COPY[key].blurb,
  perks: [...limitPerks(key), ...COPY[key].extras],
  featured: COPY[key].featured,
}))
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @replyooo/web exec vitest run test/billing.test.ts test/plans.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Server actions**

Append to `apps/web/src/app/actions.ts` (add imports `import { billingCustomer, startPlanChange } from '@/lib/billing/checkout'`, `import { createPortalSession, dodoConfig, DodoError } from '@/lib/billing/dodo'`, `import { appUrl } from '@/lib/env'`):
```ts
export async function switchPlan(formData: FormData) {
  const workspace = await requireManager()
  const plan = String(formData.get('plan') ?? '')
  const config = dodoConfig()
  if (!config || (plan !== 'pro' && plan !== 'business')) redirect('/settings?billing=unavailable#billing')
  let destination: string
  try {
    destination = await startPlanChange(config, workspace, plan)
  } catch (error) {
    if (!(error instanceof DodoError)) throw error
    console.error('dodo plan change failed', error)
    destination = '/settings?billing=error#billing'
  }
  redirect(destination)
}

export async function openBillingPortal() {
  const { workspaceId } = await requireManager()
  const config = dodoConfig()
  const customerId = await billingCustomer(workspaceId)
  if (!config || !customerId) redirect('/settings?billing=unavailable#billing')
  let destination: string
  try {
    destination = await createPortalSession(config, customerId, appUrl('/settings#billing'))
  } catch (error) {
    if (!(error instanceof DodoError)) throw error
    console.error('dodo portal failed', error)
    destination = '/settings?billing=error#billing'
  }
  redirect(destination)
}
```
(`redirect()` throws to navigate, so it stays outside the `try`.)

- [ ] **Step 6: Settings → Billing UI**

In `apps/web/src/app/(app)/settings/page.tsx`:
- delete the local `const PLANS = […]` and import `PLAN_CATALOG` from `@/lib/plans`; replace `import { PLAN_LIMITS } from '@replyooo/shared'` with `import { PLAN_NAMES } from '@replyooo/shared'`; add `openBillingPortal, switchPlan` to the `@/app/actions` import and `import { dodoConfig } from '@/lib/billing/dodo'`;
- add below `NOTICES`:
```ts
const BILLING_NOTICES: Record<string, string> = {
  updated: 'Thanks! Your plan changes as soon as Dodo Payments confirms the payment, usually within a few seconds.',
  unavailable: 'Billing isn’t set up yet.',
  error: 'Dodo Payments didn’t respond. Try again in a minute.',
}
const PAYMENT_PROBLEMS = new Set(['on_hold', 'past_due', 'failed'])
```
- add `billing?: string` to `searchParams`, destructure it, and compute `const billingEnabled = dodoConfig() !== null` and `const billingNotice = billing ? BILLING_NOTICES[billing] : undefined`;
- replace the whole `<SettingsSection id="billing" …>…</SettingsSection>` with:
```tsx
      <SettingsSection id="billing" title="Billing" description="Plans are metered on contacts reached per month.">
        {billingNotice && <p role="status" className="mb-3 text-[13px] text-muted">{billingNotice}</p>}
        {manager && subscription.billedPlan !== 'free' && PAYMENT_PROBLEMS.has(subscription.status) && (
          <Card className="mb-4 flex items-center gap-3 border-[#ffb59a] p-4 text-[13.5px]">
            <TriangleAlert className="size-4 shrink-0 text-brand" />
            Your last payment didn’t go through. Update your payment method to keep {PLAN_NAMES[subscription.billedPlan]}.
            {billingEnabled && subscription.hasBillingAccount && (
              <form action={openBillingPortal} className="ml-auto">
                <button type="submit" className={buttonClass('dark', 'sm')}>
                  Update payment
                </button>
              </form>
            )}
          </Card>
        )}
        <Card className="p-5">
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] font-semibold">This month</span>
            <span className="text-[13px] text-subtle">
              {formatNumber(subscription.contactsReached)} / {formatNumber(subscription.contactsLimit)} contacts reached
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-sand">
            <div className="h-full rounded-full bg-ink" style={{ width: `${Math.min(100, usage * 100)}%` }} />
          </div>
          {subscription.renewsAt && subscription.plan !== 'free' && (
            <p className="mt-3 text-[12.5px] text-subtle">
              {PLAN_NAMES[subscription.plan]} renews on{' '}
              {new Date(subscription.renewsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.
            </p>
          )}
        </Card>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {PLAN_CATALOG.map((plan) => {
            const current = plan.key === subscription.plan
            const canAct = manager && billingEnabled
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
                  {plan.perks.map((perk) => (
                    <li key={perk}>{perk}</li>
                  ))}
                </ul>
                {current ? (
                  <button type="button" disabled className={cx(buttonClass('secondary', 'sm'), 'mt-5')}>
                    Your plan
                  </button>
                ) : plan.key === 'free' ? (
                  canAct && subscription.hasBillingAccount ? (
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
                    <button type="submit" disabled={!canAct} className={cx(buttonClass('dark', 'sm'), 'w-full')}>
                      Switch to {plan.name}
                    </button>
                  </form>
                )}
              </Card>
            )
          })}
        </div>
        {manager && billingEnabled && subscription.hasBillingAccount && (
          <form action={openBillingPortal} className="mt-4">
            <button type="submit" className="text-[13px] font-semibold text-ink hover:underline">
              Manage billing and invoices →
            </button>
          </form>
        )}
        {!billingEnabled && <p className="mt-4 text-[12.5px] text-subtle">Billing isn’t set up yet. Plans can be changed once payments are configured.</p>}
        {billingEnabled && !manager && <p className="mt-4 text-[12.5px] text-subtle">Only owners and admins can change the plan.</p>}
      </SettingsSection>
```

- [ ] **Step 7: Run the web suite, typecheck and build**

Run: `pnpm --filter @replyooo/web exec vitest run && pnpm --filter @replyooo/web typecheck && pnpm --filter @replyooo/web build`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): checkout, plan changes and billing portal through Dodo Payments"
```

---

### Task 10: Meta signed requests, and remember which Meta user connected each account

**Files:**
- Create: `packages/meta/src/signed-request.ts`
- Modify: `packages/meta/src/oauth.ts`, `packages/meta/src/index.ts`, `apps/web/src/lib/connect.ts`
- Test: `packages/meta/test/signed-request.test.ts`, `packages/meta/test/oauth.test.ts`, `apps/web/test/connect.test.ts`

**Interfaces:**
- Consumes: `connectedAccounts.metaUserId` (Task 2).
- Produces:
  ```ts
  // @replyooo/meta
  interface SignedRequest { userId: string; issuedAt: number | null }
  function parseSignedRequest(signedRequest: string, appSecret: string): SignedRequest | null
  InstagramConnection.metaUserId: string | null   // /me `id` (app-scoped user id)
  interface FacebookConnection { metaUserId: string; pages: FacebookPageConnection[] }
  function exchangeFacebookCode(app: OAuthApp, code: string): Promise<FacebookConnection>   // was Promise<FacebookPageConnection[]>
  // apps/web lib/connect.ts
  AccountInput.metaUserId: string | null   // stored in connected_accounts.meta_user_id
  ```

- [ ] **Step 1: Write the failing meta tests**

`packages/meta/test/signed-request.test.ts`:
```ts
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseSignedRequest } from '../src/signed-request'

function sign(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(body).digest('base64url')
  return `${signature}.${body}`
}

describe('parseSignedRequest', () => {
  it('returns the user for a request signed with the app secret', () => {
    expect(parseSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: '1234', issued_at: 1_790_000_000 }, 'app-secret'), 'app-secret')).toEqual({
      userId: '1234',
      issuedAt: 1_790_000_000,
    })
    expect(parseSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: 98765 }, 'app-secret'), 'app-secret')).toEqual({ userId: '98765', issuedAt: null })
  })

  it('rejects other secrets, tampering, other algorithms and garbage', () => {
    const good = sign({ algorithm: 'HMAC-SHA256', user_id: '1234' }, 'app-secret')
    expect(parseSignedRequest(good, 'other-secret')).toBeNull()
    const [signature] = good.split('.')
    const forged = `${signature}.${Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '9999' })).toString('base64url')}`
    expect(parseSignedRequest(forged, 'app-secret')).toBeNull()
    expect(parseSignedRequest(sign({ algorithm: 'none', user_id: '1234' }, 'app-secret'), 'app-secret')).toBeNull()
    expect(parseSignedRequest(sign({ algorithm: 'HMAC-SHA256' }, 'app-secret'), 'app-secret')).toBeNull()
    expect(parseSignedRequest('not-a-signed-request', 'app-secret')).toBeNull()
    expect(parseSignedRequest('', 'app-secret')).toBeNull()
  })
})
```

In `packages/meta/test/oauth.test.ts`:
- in `'exchanges a code for a long-lived token and the professional profile'`, add `id: 'IGSU_1'` to the mocked `/me` JSON, make sure the `fields` list the implementation requests now includes `id` (the existing test doesn’t assert `fields`, so no expectation change is needed there), and add `metaUserId: 'IGSU_1'` to the expected connection;
- in `'exchanges a code for page tokens of every granted Page'`, add a handler:
```ts
      http.get('https://graph.facebook.com/v24.0/me', ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer FB_LONG_USER')
        return HttpResponse.json({ id: 'FBU_1' })
      }),
```
  and change the expectation to `expect(await exchangeFacebookCode(fbApp, 'FBCODE')).toEqual({ metaUserId: 'FBU_1', pages: [ …the existing page object… ] })`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @replyooo/meta exec vitest run test/signed-request.test.ts test/oauth.test.ts`
Expected: FAIL — module missing; `metaUserId` absent.

- [ ] **Step 3: Implement**

`packages/meta/src/signed-request.ts`:
```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

export interface SignedRequest {
  /** App-scoped ID of the person who removed the app or asked for deletion. */
  userId: string
  issuedAt: number | null
}

/**
 * Meta's deauthorize and data-deletion callbacks post `signed_request`:
 * `<base64url HMAC-SHA256(payload segment, app secret)>.<base64url JSON>`. Returns null unless the
 * signature matches and the payload names HMAC-SHA256 and a user.
 */
export function parseSignedRequest(signedRequest: string, appSecret: string): SignedRequest | null {
  const [encodedSignature, encodedPayload, ...rest] = signedRequest.split('.')
  if (!encodedSignature || !encodedPayload || rest.length > 0) return null
  const expected = createHmac('sha256', appSecret).update(encodedPayload).digest()
  const given = Buffer.from(encodedSignature, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  let payload: { algorithm?: unknown; user_id?: unknown; issued_at?: unknown }
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof payload.algorithm !== 'string' || payload.algorithm.toUpperCase() !== 'HMAC-SHA256') return null
  if (typeof payload.user_id !== 'string' && typeof payload.user_id !== 'number') return null
  return { userId: String(payload.user_id), issuedAt: typeof payload.issued_at === 'number' ? payload.issued_at : null }
}
```
`packages/meta/src/index.ts` → add `export * from './signed-request'`.

`packages/meta/src/oauth.ts`:
- add to `InstagramConnection`:
```ts
  /** `id` from /me: the app-scoped user ID Meta's deauthorize and data-deletion callbacks name. */
  metaUserId: string | null
```
- add below `FacebookPageConnection`:
```ts
export interface FacebookConnection {
  /** App-scoped ID of the Facebook user who granted the Pages. */
  metaUserId: string
  pages: FacebookPageConnection[]
}
```
- in `exchangeInstagramCode`: add `id?: string | number` to the `/me` response type, change `fields` to `'id,user_id,username,name,profile_picture_url,account_type,followers_count'`, and add `metaUserId: me.id === undefined ? null : String(me.id),` to the returned object;
- in `exchangeFacebookCode`: change the return type to `Promise<FacebookConnection>`, add after the `long` request:
```ts
  const me = await graphRequest<{ id: string }>({ baseUrl, path: 'me', token: long.access_token, query: { fields: 'id' } })
```
  and wrap the existing `pages.data.flatMap(…)` result: `return { metaUserId: String(me.id), pages: pages.data.flatMap(…) }`.

`apps/web/src/lib/connect.ts`:
- add `metaUserId: string | null` to `interface AccountInput` and `metaUserId: input.metaUserId,` to the `profile` object in `saveConnectedAccount`;
- in `connectFacebook`, change `const pages = await exchangeFacebookCode(…)` to:
```ts
  const { metaUserId, pages } = await exchangeFacebookCode(oauthApp('facebook'), code)
```
  and the save call to `saveConnectedAccount(db, workspaceId, userId, { platform: 'facebook', ...page, metaUserId, expiresAt: null })`.
  (`connectInstagram` already spreads `connection`, which now carries `metaUserId`.)

In `apps/web/test/connect.test.ts`:
- in `instagram()`, add `id: \`IGSU_${IG_ID}\`` to the `/me` JSON;
- in `facebook()`, add `http.get('https://graph.facebook.com/v24.0/me', () => HttpResponse.json({ id: 'FBU_42' })),`;
- in `'stores the account with an encrypted long-lived token and subscribes webhooks'`, add `metaUserId: \`IGSU_${IG_ID}\`,` to the `toMatchObject`;
- in `'connects every granted Page and skips ones owned elsewhere'`, add `expect(rows[0]?.metaUserId).toBe('FBU_42')`.

- [ ] **Step 4: Run the meta and web suites**

Run: `pnpm --filter @replyooo/meta exec vitest run && pnpm --filter @replyooo/web exec vitest run test/connect.test.ts && pnpm typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/meta apps/web
git commit -m "feat(meta): parse signed requests and record the Meta user behind each connection"
```

---

### Task 11: Meta deauthorize and data-deletion callbacks

**Files:**
- Create: `apps/web/src/lib/meta-callbacks.ts`, `apps/web/src/app/api/meta/deauthorize/route.ts`, `apps/web/src/app/api/meta/data-deletion/route.ts`
- Test: `apps/web/test/meta-callbacks.test.ts`

**Interfaces:**
- Consumes: `parseSignedRequest` (Task 10); `connectedAccounts.metaUserId`, `dataDeletionRequests` (Task 2); `appUrl` (Task 5).
- Produces:
  ```ts
  function verifyMetaSignedRequest(signedRequest: string): { platform: Platform; userId: string } | null
  function deauthorizeMetaUser(db: Db, platform: Platform, userId: string): Promise<number>          // accounts disconnected
  function deleteMetaUserData(db: Db, platform: Platform, userId: string): Promise<{ confirmationCode: string; accountsDeleted: number }>
  function findDeletionRequest(db: Db, code: string): Promise<{ createdAt: Date; accountsDeleted: number } | null>
  ```

- [ ] **Step 1: Write the failing test**

`apps/web/test/meta-callbacks.test.ts`:
```ts
import { connectedAccounts, contacts } from '@replyooo/db'
import { eq } from 'drizzle-orm'
import { createHmac, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { POST as dataDeletion } from '@/app/api/meta/data-deletion/route'
import { POST as deauthorize } from '@/app/api/meta/deauthorize/route'
import { findDeletionRequest } from '@/lib/meta-callbacks'
import { db } from '@/lib/db'
import { createAccount, createContact, createWorkspace } from './support'

// test/setup.ts sets META_APP_SECRET=fb-secret and INSTAGRAM_APP_SECRET=ig-secret.
function signed(userId: string, secret: string) {
  const body = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: userId, issued_at: 1_790_000_000 })).toString('base64url')
  return `${createHmac('sha256', secret).update(body).digest('base64url')}.${body}`
}

function post(signedRequest: string) {
  return new Request('http://localhost:3000/api/meta/callback', {
    method: 'POST',
    body: new URLSearchParams({ signed_request: signedRequest }),
  })
}

async function account(id: string) {
  const [row] = await db().select().from(connectedAccounts).where(eq(connectedAccounts.id, id))
  return row
}

describe('Meta data-deletion callback', () => {
  it('deletes the Facebook user’s accounts and their data, and returns a status link', async () => {
    const userId = `fbu_${randomUUID()}`
    const { workspaceId } = await createWorkspace('Deleter')
    const page = await createAccount(workspaceId, 'facebook', { metaUserId: userId })
    const contact = await createContact(workspaceId, page.id)
    const someoneElse = await createAccount(workspaceId, 'facebook', { metaUserId: `fbu_${randomUUID()}` })

    const response = await dataDeletion(post(signed(userId, 'fb-secret')))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { url: string; confirmation_code: string }
    expect(body.confirmation_code).toMatch(/^[0-9a-f]{16}$/)
    expect(body.url).toBe(`http://localhost:3000/data-deletion/status?code=${body.confirmation_code}`)

    expect(await account(page.id)).toBeUndefined()
    expect(await db().select().from(contacts).where(eq(contacts.id, contact.id))).toEqual([])
    expect(await account(someoneElse.id)).toBeDefined()
    expect(await findDeletionRequest(db(), body.confirmation_code)).toMatchObject({ accountsDeleted: 1 })
  })

  it('matches Instagram accounts by the app-scoped id or the account id', async () => {
    const igUser = `igu_${randomUUID()}`
    const { workspaceId } = await createWorkspace('IGDeleter')
    const byMetaUser = await createAccount(workspaceId, 'instagram', { metaUserId: igUser })
    const byExternal = await createAccount(workspaceId, 'instagram', { externalId: igUser })

    await dataDeletion(post(signed(igUser, 'ig-secret')))
    expect(await account(byMetaUser.id)).toBeUndefined()
    expect(await account(byExternal.id)).toBeUndefined()
  })

  it('rejects a request with a bad signature and deletes nothing', async () => {
    const userId = `fbu_${randomUUID()}`
    const { workspaceId } = await createWorkspace('Forged')
    const page = await createAccount(workspaceId, 'facebook', { metaUserId: userId })

    expect((await dataDeletion(post(signed(userId, 'wrong-secret')))).status).toBe(400)
    expect((await dataDeletion(new Request('http://localhost:3000/x', { method: 'POST', body: 'nonsense' }))).status).toBe(400)
    expect(await account(page.id)).toBeDefined()
  })
})

describe('Meta deauthorize callback', () => {
  it('marks the user’s accounts disconnected and keeps their data', async () => {
    const userId = `fbu_${randomUUID()}`
    const { workspaceId } = await createWorkspace('Remover')
    const page = await createAccount(workspaceId, 'facebook', { metaUserId: userId })

    expect((await deauthorize(post(signed(userId, 'fb-secret')))).status).toBe(200)
    expect(await account(page.id)).toMatchObject({ status: 'disconnected' })
  })

  it('a Facebook-signed request never touches Instagram accounts', async () => {
    const userId = `shared_${randomUUID()}`
    const { workspaceId } = await createWorkspace('CrossPlatform')
    const ig = await createAccount(workspaceId, 'instagram', { metaUserId: userId })
    await deauthorize(post(signed(userId, 'fb-secret')))
    expect(await account(ig.id)).toMatchObject({ status: 'active' })
  })
})
```


- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @replyooo/web exec vitest run test/meta-callbacks.test.ts`
Expected: FAIL — route modules missing.

- [ ] **Step 3: Implement**

`apps/web/src/lib/meta-callbacks.ts`:
```ts
import 'server-only'
import { connectedAccounts, dataDeletionRequests, type Db } from '@replyooo/db'
import { parseSignedRequest } from '@replyooo/meta'
import type { Platform } from '@replyooo/shared'
import { and, eq, or } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { env } from './env'

/** Which app signed it tells us the platform: Facebook Login uses META_APP_SECRET, Instagram Login INSTAGRAM_APP_SECRET. */
export function verifyMetaSignedRequest(signedRequest: string): { platform: Platform; userId: string } | null {
  const e = env()
  const apps: [Platform, string][] = [
    ['facebook', e.META_APP_SECRET],
    ['instagram', e.INSTAGRAM_APP_SECRET],
  ]
  for (const [platform, secret] of apps) {
    const parsed = parseSignedRequest(signedRequest, secret)
    if (parsed) return { platform, userId: parsed.userId }
  }
  return null
}

/**
 * The accounts a Meta user granted. Keyed by the Meta user (authenticated by the signed request),
 * not by workspace: these callbacks come from Meta, not from a signed-in session. Instagram also
 * matches the account id, in case Meta sends that instead of the app-scoped id.
 */
function grantedBy(platform: Platform, userId: string) {
  const byUser = eq(connectedAccounts.metaUserId, userId)
  return and(eq(connectedAccounts.platform, platform), platform === 'instagram' ? or(byUser, eq(connectedAccounts.externalId, userId)) : byUser)
}

/** The person removed the app, so the tokens are dead: stop using the accounts but keep the data. */
export async function deauthorizeMetaUser(db: Db, platform: Platform, userId: string): Promise<number> {
  const rows = await db
    .update(connectedAccounts)
    .set({ status: 'disconnected' })
    .where(grantedBy(platform, userId))
    .returning({ id: connectedAccounts.id })
  return rows.length
}

/** Deletes the accounts; contacts, messages, automations and runs cascade from them. */
export async function deleteMetaUserData(
  db: Db,
  platform: Platform,
  userId: string,
): Promise<{ confirmationCode: string; accountsDeleted: number }> {
  const confirmationCode = randomBytes(8).toString('hex')
  const accountsDeleted = await db.transaction(async (tx) => {
    const deleted = await tx.delete(connectedAccounts).where(grantedBy(platform, userId)).returning({ id: connectedAccounts.id })
    await tx.insert(dataDeletionRequests).values({ confirmationCode, platform, metaUserId: userId, accountsDeleted: deleted.length })
    return deleted.length
  })
  return { confirmationCode, accountsDeleted }
}

export async function findDeletionRequest(db: Db, code: string): Promise<{ createdAt: Date; accountsDeleted: number } | null> {
  if (!/^[0-9a-f]{16}$/.test(code)) return null
  const [row] = await db
    .select({ createdAt: dataDeletionRequests.createdAt, accountsDeleted: dataDeletionRequests.accountsDeleted })
    .from(dataDeletionRequests)
    .where(eq(dataDeletionRequests.confirmationCode, code))
  return row ?? null
}

/** Reads `signed_request` from Meta's form-encoded POST and verifies it. */
export async function signedRequestFrom(request: Request) {
  const form = await request.formData().catch(() => null)
  const value = form?.get('signed_request')
  return typeof value === 'string' ? verifyMetaSignedRequest(value) : null
}
```

`apps/web/src/app/api/meta/deauthorize/route.ts`:
```ts
import { db } from '@/lib/db'
import { deauthorizeMetaUser, signedRequestFrom } from '@/lib/meta-callbacks'

/** Meta "Deauthorize callback URL" (spec §5.3). */
export async function POST(request: Request) {
  const signed = await signedRequestFrom(request)
  if (!signed) return new Response('Invalid signed_request', { status: 400 })
  await deauthorizeMetaUser(db(), signed.platform, signed.userId)
  return new Response(null, { status: 200 })
}
```

`apps/web/src/app/api/meta/data-deletion/route.ts`:
```ts
import { db } from '@/lib/db'
import { appUrl } from '@/lib/env'
import { deleteMetaUserData, signedRequestFrom } from '@/lib/meta-callbacks'

/** Meta "Data deletion request URL" (spec §5.3, §7). Meta shows the person the URL and code we return. */
export async function POST(request: Request) {
  const signed = await signedRequestFrom(request)
  if (!signed) return new Response('Invalid signed_request', { status: 400 })
  const { confirmationCode } = await deleteMetaUserData(db(), signed.platform, signed.userId)
  return Response.json({
    url: appUrl(`/data-deletion/status?code=${confirmationCode}`),
    confirmation_code: confirmationCode,
  })
}
```

- [ ] **Step 4: Run the test, suite, typecheck and build**

Run: `pnpm --filter @replyooo/web exec vitest run && pnpm --filter @replyooo/web typecheck && pnpm --filter @replyooo/web build`
Expected: all PASS; routes include `/api/meta/deauthorize`, `/api/meta/data-deletion`. (The `/data-deletion/status` page that the returned URL points to is built in Task 12.)

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): handle Meta deauthorize and data-deletion callbacks"
```

---

### Task 12: Public pages — pricing, privacy, terms, data-deletion instructions

**Files:**
- Create: `apps/web/src/components/marketing.tsx`, `apps/web/src/lib/legal.ts`, `apps/web/src/app/(marketing)/pricing/page.tsx`, `apps/web/src/app/(marketing)/privacy/page.tsx`, `apps/web/src/app/(marketing)/terms/page.tsx`, `apps/web/src/app/(marketing)/data-deletion/page.tsx`, `apps/web/src/app/(marketing)/data-deletion/status/page.tsx`
- Modify: `apps/web/src/app/(marketing)/page.tsx`
- Test: `apps/web/test/marketing.test.ts`

**Interfaces:**
- Consumes: `PLAN_CATALOG` (Task 9); `findDeletionRequest` (Task 11).
- Produces: `MarketingHeader()`, `MarketingFooter()`, `PricingCards()`, `LegalPage({ title, children })`; `LEGAL = { company, contactEmail, updated }`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/marketing.test.ts`:
```ts
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LEGAL } from '@/lib/legal'

const marketing = fileURLToPath(new URL('../src/app/(marketing)', import.meta.url))

describe('public pages', () => {
  it('has every page Meta App Review and the footer link to', () => {
    const pages = readdirSync(marketing, { recursive: true }).map(String).filter((p) => p.endsWith('page.tsx'))
    expect(pages.sort()).toEqual(
      ['data-deletion/page.tsx', 'data-deletion/status/page.tsx', 'page.tsx', 'pricing/page.tsx', 'privacy/page.tsx', 'terms/page.tsx'].sort(),
    )
  })

  it('names a contact address for privacy requests', () => {
    expect(LEGAL.contactEmail).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @replyooo/web exec vitest run test/marketing.test.ts`
Expected: FAIL — `@/lib/legal` missing; pages missing.

- [ ] **Step 3: Shared marketing components and legal constants**

`apps/web/src/lib/legal.ts`:
```ts
/**
 * Shown on the privacy policy, terms and data-deletion pages, and reviewed by Meta in App Review.
 * Replace with the legal entity and a monitored inbox before launch, and have the texts reviewed.
 */
export const LEGAL = {
  company: 'Replyooo',
  contactEmail: 'privacy@replyooo.com',
  updated: 'October 6, 2026',
}
```

`apps/web/src/components/marketing.tsx`:
```tsx
import { ArrowRight, Check } from 'lucide-react'
import Link from 'next/link'
import { ButtonLink, Logo, cx } from '@/components/ui'
import { PLAN_CATALOG } from '@/lib/plans'

export function MarketingHeader() {
  return (
    <header className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-5">
      <Link href="/">
        <Logo />
      </Link>
      <nav className="hidden items-center gap-8 text-[14px] text-muted md:flex">
        <Link href="/#how" className="hover:text-ink">How it works</Link>
        <Link href="/#features" className="hover:text-ink">Features</Link>
        <Link href="/pricing" className="hover:text-ink">Pricing</Link>
      </nav>
      <div className="flex items-center gap-2">
        <Link href="/login" className="px-3 text-[14px] font-semibold">
          Log in
        </Link>
        <ButtonLink href="/signup" size="sm">
          Start free <ArrowRight className="size-3.5" />
        </ButtonLink>
      </div>
    </header>
  )
}

export function MarketingFooter() {
  return (
    <footer className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-6 pt-4 pb-12 text-[13px] text-subtle">
      <Logo />
      <nav className="flex gap-6">
        <Link href="/pricing" className="hover:text-ink">Pricing</Link>
        <Link href="/privacy" className="hover:text-ink">Privacy</Link>
        <Link href="/terms" className="hover:text-ink">Terms</Link>
        <Link href="/data-deletion" className="hover:text-ink">Data deletion</Link>
      </nav>
      <span>© {new Date().getFullYear()} Replyooo. Not affiliated with Instagram or Meta.</span>
    </footer>
  )
}

export function PricingCards() {
  return (
    <div className="mx-auto mt-12 grid max-w-[980px] gap-5 text-left md:grid-cols-3">
      {PLAN_CATALOG.map((plan) => (
        <div
          key={plan.key}
          className={cx('flex flex-col rounded-[24px] border p-7', plan.featured ? 'border-ink bg-ink text-white' : 'border-line bg-white')}
        >
          <div className="flex items-center justify-between">
            <span className="text-[16px] font-semibold">{plan.name}</span>
            {plan.featured && <span className="rounded-full bg-lime px-2.5 py-0.5 text-[11px] font-semibold text-ink">Most popular</span>}
          </div>
          <div className="mt-4 font-display text-[44px] leading-none font-bold tracking-[-0.04em]">
            {plan.price}
            <span className={cx('font-sans text-[14px] font-normal tracking-normal', plan.featured ? 'text-white/50' : 'text-subtle')}>/month</span>
          </div>
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
  )
}

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="bg-sand">
      <MarketingHeader />
      <main className="mx-auto max-w-[760px] px-6 py-16">
        <h1 className="font-display text-[44px] leading-tight font-bold tracking-[-0.04em]">{title}</h1>
        <p className="mt-2 text-[13.5px] text-subtle">Last updated {updated}</p>
        <div className="mt-10 flex flex-col gap-5 text-[15px] leading-relaxed text-ink-2 [&_h2]:mt-6 [&_h2]:text-[20px] [&_h2]:font-semibold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5 [&_a]:underline">
          {children}
        </div>
      </main>
      <MarketingFooter />
    </div>
  )
}
```

- [ ] **Step 4: Use them on the landing page**

In `apps/web/src/app/(marketing)/page.tsx`:
- delete the local `const PLANS = […]`;
- replace the `<header …>…</header>` block with `<MarketingHeader />` and the `<footer …>…</footer>` block with `<MarketingFooter />`;
- in the `#pricing` section, replace the `<div className="mx-auto mt-12 grid …">…</div>` grid with `<PricingCards />`;
- import `{ MarketingFooter, MarketingHeader, PricingCards }` from `@/components/marketing` and remove imports that become unused (e.g. `Check`, `Link`, if nothing else uses them; `typecheck` and the build will tell you).

- [ ] **Step 5: The four pages**

`apps/web/src/app/(marketing)/pricing/page.tsx`:
```tsx
import type { Metadata } from 'next'
import { MarketingFooter, MarketingHeader, PricingCards } from '@/components/marketing'

export const metadata: Metadata = { title: 'Pricing' }

export default function PricingPage() {
  return (
    <div className="bg-sand">
      <MarketingHeader />
      <main className="px-6 py-16 text-center">
        <h1 className="font-display text-[52px] leading-tight font-bold tracking-[-0.04em]">Free until it’s working.</h1>
        <p className="mt-2 text-[15px] text-muted">
          Plans are metered on contacts reached per month: a person counts once a month, the first time Replyooo messages them.
        </p>
        <PricingCards />
        <p className="mx-auto mt-10 max-w-[620px] text-[13.5px] text-subtle">
          When you reach your monthly contacts, conversations already in progress finish and new ones pause until the 1st of the next
          month, or until you upgrade. Payments are handled by Dodo Payments, our merchant of record. Cancel any time from Settings →
          Billing.
        </p>
      </main>
      <MarketingFooter />
    </div>
  )
}
```

`apps/web/src/app/(marketing)/privacy/page.tsx`:
```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPage } from '@/components/marketing'
import { LEGAL } from '@/lib/legal'

export const metadata: Metadata = { title: 'Privacy policy' }

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated={LEGAL.updated}>
      <p>
        {LEGAL.company} (“we”) runs Replyooo, a tool that replies to Instagram and Facebook comments and messages for the businesses and
        creators who connect their accounts (“customers”). This policy explains what we collect, why, and how to get it deleted.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>Customer accounts: name, email address, password (stored hashed) or Google sign-in, and workspace membership.</li>
        <li>
          Connected Instagram and Facebook accounts: account ID, username, name, profile picture, follower count and the access token
          Meta issues (encrypted with AES-256-GCM).
        </li>
        <li>
          People who interact with a connected account (“contacts”): their Instagram or Facebook ID, username, name and profile picture,
          the comments and messages they send to that account, the replies Replyooo sends, and any email address or phone number they
          choose to share in the conversation.
        </li>
        <li>Billing: plan, subscription status and the customer ID from Dodo Payments. We never see or store card details.</li>
      </ul>

      <h2>How we use it</h2>
      <p>
        Only to provide the service our customers set up: matching comments and messages to their automations, sending the replies they
        wrote, showing their contacts and conversation history in the dashboard, counting usage for billing, and emailing customers about
        their account (verification, password resets, invitations, and when Meta needs them to reconnect). We don’t sell personal data,
        use it for advertising, or combine data from different customers.
      </p>

      <h2>Data from Meta</h2>
      <p>
        We use Instagram and Facebook Platform data only to operate the features the connected account’s owner turned on, in line with
        Meta’s Platform Terms. Access ends when the owner disconnects the account in Replyooo or removes Replyooo in their Instagram or
        Facebook settings.
      </p>

      <h2>Who processes it for us</h2>
      <ul>
        <li>Our hosting provider, which runs our servers and database.</li>
        <li>Dodo Payments, our merchant of record, for subscriptions and invoices.</li>
        <li>Our email provider (Resend or our SMTP provider), to deliver account emails.</li>
        <li>Meta, to receive and send the messages and comments themselves.</li>
      </ul>

      <h2>How long we keep it</h2>
      <p>
        Raw webhook deliveries from Meta are deleted after 30 days. Everything else is kept until the customer deletes it, deletes their
        workspace, or the account owner asks Meta to delete their data. Deleting a workspace removes its connected accounts, contacts,
        messages and automations immediately.
      </p>

      <h2>Your choices</h2>
      <p>
        Contacts can ask the business they messaged, or us, to delete what we hold about them. Account owners can delete their data at
        any time; see <Link href="/data-deletion">how to delete your data</Link>. Write to{' '}
        <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a> for any privacy request; we answer within 30 days.
      </p>

      <h2>Security</h2>
      <p>
        Access tokens are encrypted at rest, passwords are hashed, every request is checked against the signed-in workspace, and Meta’s
        webhooks are verified by signature before we process them.
      </p>

      <h2>Changes</h2>
      <p>We’ll update the date above when this policy changes, and email customers about material changes.</p>
    </LegalPage>
  )
}
```

`apps/web/src/app/(marketing)/terms/page.tsx`:
```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPage } from '@/components/marketing'
import { LEGAL } from '@/lib/legal'

export const metadata: Metadata = { title: 'Terms of service' }

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated={LEGAL.updated}>
      <p>
        These terms are an agreement between you and {LEGAL.company} for using Replyooo. By creating an account you accept them.
      </p>

      <h2>Your account</h2>
      <p>
        You’re responsible for your workspace, the people you invite to it, and keeping your password safe. You must be able to enter a
        contract where you live and have the right to manage every Instagram or Facebook account you connect.
      </p>

      <h2>Acceptable use</h2>
      <ul>
        <li>Follow Instagram’s and Facebook’s terms and community guidelines, and Meta’s messaging policies, including the 24-hour messaging window.</li>
        <li>Only message people who contacted your account first, and don’t send spam, deceptive content or anything illegal.</li>
        <li>Don’t try to break, overload or reverse-engineer the service, or access other customers’ data.</li>
      </ul>
      <p>We may suspend automations or accounts that put Meta’s access for all customers at risk.</p>

      <h2>Plans and billing</h2>
      <p>
        Paid plans renew monthly until cancelled. Dodo Payments is our merchant of record and handles payment, invoices, taxes and
        refunds under its own terms. You can change or cancel your plan in Settings → Billing; a cancelled plan stays active until the end
        of the period you paid for. Usage limits are listed on the <Link href="/pricing">pricing page</Link>.
      </p>

      <h2>Your content and data</h2>
      <p>
        You own the automations you write and the data of your contacts. You let us process it only to run the service, as described in
        our <Link href="/privacy">privacy policy</Link>. You’re responsible for having a lawful basis to collect the emails and phone
        numbers your automations ask for.
      </p>

      <h2>Availability</h2>
      <p>
        We work to keep Replyooo running, but it depends on Meta’s platform, which can change or limit access at any time. The service is
        provided “as is”, without warranties beyond what the law requires.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent the law allows, our total liability for any claim is limited to what you paid us in the 12 months before it, and
        we’re not liable for indirect or consequential losses, such as lost profits or followers.
      </p>

      <h2>Ending the agreement</h2>
      <p>
        You can delete your workspace at any time in Settings. We may end accounts that break these terms, after notice where possible.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.
      </p>
    </LegalPage>
  )
}
```

`apps/web/src/app/(marketing)/data-deletion/page.tsx`:
```tsx
import type { Metadata } from 'next'
import { LegalPage } from '@/components/marketing'
import { LEGAL } from '@/lib/legal'

export const metadata: Metadata = { title: 'Delete your data' }

export default function DataDeletionPage() {
  return (
    <LegalPage title="Delete your data" updated={LEGAL.updated}>
      <p>There are three ways to delete the data Replyooo holds about you.</p>

      <h2>1. Delete your workspace</h2>
      <p>
        If you use Replyooo, open Settings → Delete workspace. It immediately deletes every connected account, contact, message and
        automation in that workspace.
      </p>

      <h2>2. Remove Replyooo from Instagram or Facebook</h2>
      <ul>
        <li>Instagram: Settings and activity → Website permissions → Apps and websites → Replyooo → Remove.</li>
        <li>Facebook: Settings &amp; privacy → Settings → Business integrations → Replyooo → Remove.</li>
      </ul>
      <p>
        Removing the app stops Replyooo from using your account. If you also choose to delete your data there, Meta sends us a deletion
        request: we delete the connected account and everything stored for it, and Meta shows you a confirmation code you can check on
        our status page.
      </p>

      <h2>3. Email us</h2>
      <p>
        Write to <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a> from the address on your account, or, if you messaged
        a business that uses Replyooo, tell us its Instagram or Facebook username and yours. We confirm when it’s done, within 30 days.
      </p>
    </LegalPage>
  )
}
```

- [ ] **Step 5b: The data-deletion status page** (the URL Task 11's callback returns to Meta)

`apps/web/src/app/(marketing)/data-deletion/status/page.tsx`:
```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketingFooter, MarketingHeader } from '@/components/marketing'
import { db } from '@/lib/db'
import { findDeletionRequest } from '@/lib/meta-callbacks'

export const metadata: Metadata = { title: 'Data deletion status' }

export default async function DeletionStatusPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code = '' } = await searchParams
  const request = await findDeletionRequest(db(), code)
  return (
    <div className="bg-sand">
      <MarketingHeader />
      <main className="mx-auto max-w-[720px] px-6 py-16">
        <h1 className="font-display text-[40px] leading-tight font-bold tracking-[-0.04em]">Data deletion status</h1>
        {request ? (
          <div className="mt-6 rounded-[20px] bg-white p-6 text-[15px] leading-relaxed text-ink-2">
            <p>
              Request <span className="font-mono">{code}</span> was completed on{' '}
              {request.createdAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.
            </p>
            <p className="mt-3">
              {request.accountsDeleted === 1 ? '1 connected account was' : `${request.accountsDeleted} connected accounts were`} deleted,
              together with their contacts, conversations and automations.
            </p>
          </div>
        ) : (
          <p className="mt-6 text-[15px] text-muted">
            We couldn’t find that confirmation code. Check the link Meta gave you, or see{' '}
            <Link href="/data-deletion" className="underline">
              how to delete your data
            </Link>
            .
          </p>
        )}
      </main>
      <MarketingFooter />
    </div>
  )
}
```

- [ ] **Step 6: Run the test, suite, typecheck and build**

Run: `pnpm --filter @replyooo/web exec vitest run && pnpm --filter @replyooo/web typecheck && pnpm --filter @replyooo/web build`
Expected: all PASS; the route list includes `/pricing`, `/privacy`, `/terms`, `/data-deletion` as static (○) pages, plus `/data-deletion/status` (dynamic, ƒ).

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): add pricing, privacy, terms and data-deletion pages"
```

---

### Task 13: Reconnecting an account restores its live conversation starters

Disconnecting an account clears its conversation starters on Meta (Plan 3b) but leaves the automation `active`, so after a reconnect the dashboard says "Live" while Meta shows nothing. Decision: re-push on reconnect (keeps what the user set up), best-effort.

**Files:**
- Modify: `apps/web/src/lib/data/ice-breakers.ts`, `apps/web/src/lib/connect.ts`
- Test: `apps/web/test/connect.test.ts`

**Interfaces:**
- Consumes: `iceBreakerItems`, `pushIceBreakers` (existing).
- Produces: `restoreLiveIceBreakers(workspaceId: string, accountId: string): Promise<void>`.

- [ ] **Step 1: Write the failing test**

In `apps/web/test/connect.test.ts` (add `automations, automationVersions` to the `@replyooo/db` import and `import { iceBreakerItems } from '@/lib/data/ice-breakers'` plus `import { compileRecipe, DEFAULT_RECIPE } from '@/lib/recipe'`), append inside `describe('connecting Instagram', …)`:
```ts
  it('puts the live conversation starters back after a reconnect', async () => {
    const { workspaceId, user } = await createWorkspace('Restore')
    const existing = await createAccount(workspaceId, 'instagram', { externalId: IG_ID, status: 'disconnected' })
    const flow = compileRecipe({ ...DEFAULT_RECIPE, trigger: { type: 'ice_breaker', items: [{ question: 'Prices?', answer: 'From $9' }] } })
    const [automation] = await db()
      .insert(automations)
      .values({ workspaceId, connectedAccountId: existing.id, name: 'Starters', status: 'active', triggerType: 'ice_breaker', definition: flow })
      .returning()
    const [version] = await db().insert(automationVersions).values({ automationId: automation!.id, version: 1, definition: flow }).returning()
    await db().update(automations).set({ currentVersionId: version!.id }).where(eq(automations.id, automation!.id))

    instagram()
    const pushed: unknown[] = []
    server.use(
      http.post(`https://graph.instagram.com/v24.0/${IG_ID}/messenger_profile`, async ({ request }) => {
        pushed.push(await request.json())
        return HttpResponse.json({ result: 'success' })
      }),
    )

    expect((await completeConnect(db(), 'instagram', workspaceId, user.id, 'CODE')).ok).toBe(true)
    expect(pushed).toEqual([
      { platform: 'instagram', ice_breakers: [{ locale: 'default', call_to_actions: iceBreakerItems(automation!.id, flow) }] },
    ])
  })

  it('a failed restore doesn’t fail the connect', async () => {
    const { workspaceId, user } = await createWorkspace('RestoreFails')
    const existing = await createAccount(workspaceId, 'instagram', { externalId: IG_ID, status: 'disconnected' })
    const flow = compileRecipe({ ...DEFAULT_RECIPE, trigger: { type: 'ice_breaker', items: [{ question: 'Hours?', answer: '9–5' }] } })
    const [automation] = await db()
      .insert(automations)
      .values({ workspaceId, connectedAccountId: existing.id, name: 'Starters', status: 'active', triggerType: 'ice_breaker', definition: flow })
      .returning()
    const [version] = await db().insert(automationVersions).values({ automationId: automation!.id, version: 1, definition: flow }).returning()
    await db().update(automations).set({ currentVersionId: version!.id }).where(eq(automations.id, automation!.id))

    instagram()
    server.use(
      http.post(`https://graph.instagram.com/v24.0/${IG_ID}/messenger_profile`, () =>
        HttpResponse.json({ error: { message: 'Service unavailable', code: 2 } }, { status: 503 }),
      ),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await completeConnect(db(), 'instagram', workspaceId, user.id, 'CODE')).ok).toBe(true)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
```
(Add `vi` to the `vitest` import.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @replyooo/web exec vitest run test/connect.test.ts`
Expected: FAIL — no `messenger_profile` call is made.

- [ ] **Step 3: Implement**

Append to `apps/web/src/lib/data/ice-breakers.ts`:
```ts
/**
 * After a reconnect, put the account's live conversation starters back on Meta (disconnecting cleared
 * them). Best-effort: a failure leaves the account connected and is only logged.
 */
export async function restoreLiveIceBreakers(workspaceId: string, accountId: string): Promise<void> {
  const rows = await db()
    .select({ automationId: automations.id, account: connectedAccounts, live: automationVersions.definition })
    .from(automations)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, automations.connectedAccountId))
    .leftJoin(automationVersions, eq(automationVersions.id, automations.currentVersionId))
    .where(and(eq(automations.workspaceId, workspaceId), eq(automations.connectedAccountId, accountId), eq(automations.status, 'active')))
  const live = rows.find((row) => iceBreakerItems(row.automationId, row.live).length > 0)
  if (!live) return
  try {
    await pushIceBreakers(live.account, iceBreakerItems(live.automationId, live.live))
  } catch (error) {
    console.warn('restoring conversation starters failed', { accountId, error })
  }
}
```

`apps/web/src/lib/connect.ts`: `import { restoreLiveIceBreakers } from './data/ice-breakers'`, then
- in `connectInstagram`, after `const id = await saveConnectedAccount(…)`, add `if (id) await restoreLiveIceBreakers(workspaceId, id)`;
- in `connectFacebook`, change `if (id) accountIds.push(id)` to:
```ts
    if (id) {
      accountIds.push(id)
      await restoreLiveIceBreakers(workspaceId, id)
    }
```

- [ ] **Step 4: Run the web suite and typecheck**

Run: `pnpm --filter @replyooo/web exec vitest run && pnpm --filter @replyooo/web typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "fix(web): restore live conversation starters when an account reconnects"
```

---

### Task 14: End-to-end verification

**Files:**
- Modify: none expected (fix anything the checks turn up in the task that owns it).

- [ ] **Step 1: Full suite, typecheck, build**

Run: `pnpm typecheck && pnpm turbo run test --force && pnpm --filter @replyooo/web build`
Expected: 7 packages typecheck clean (shared, engine, meta, db, email, worker, web); every suite PASSES; the build lists `/forgot-password`, `/reset-password`, `/pricing`, `/privacy`, `/terms`, `/data-deletion`, `/data-deletion/status`, `/api/webhooks/dodo`, `/api/meta/deauthorize`, `/api/meta/data-deletion` and `ƒ Proxy`.

- [ ] **Step 2: Smoke test on port 3217**

Use the local Postgres from Plan 3b (`replyooo-3b-postgres-1` on `127.0.0.1:56789`) or `docker compose up -d postgres`; apply the new migration with `DATABASE_URL=… pnpm --filter @replyooo/db db:migrate`. In `apps/web/.env.local` keep the Plan 3b values and add `EMAIL_PROVIDER=log`, plus `DODO_API_KEY=dodo_test`, `DODO_WEBHOOK_SECRET=whsec_ZG9kby10ZXN0LXNpZ25pbmcta2V5`, `DODO_PRODUCT_PRO=pdt_pro`, `DODO_PRODUCT_BUSINESS=pdt_business` (dummy values; nothing calls Dodo for real). Start `pnpm --filter @replyooo/web exec next dev --port 3217` and check:
1. Sign up a new user → the dev-server log shows `[email] … subject="Confirm your email for Replyooo"` with a link; the dashboard shows the "Confirm your email" banner; opening the link lands on `/home?verified=1` and the banner is gone.
2. `/forgot-password` with that email → the log shows the reset email; its link → `/reset-password?token=…` → new password → `/login?reset=1` with the notice; the old password fails, the new one works. `/forgot-password` with an unknown email shows the same notice and logs no email.
3. Settings → invite `someone@example.com` → the log shows the invitation email with `/signup?email=someone%40example.com`.
4. Settings → Billing: three plan cards from `PLAN_CATALOG`; with the dummy Dodo key, "Switch to Pro" lands on `/settings?billing=error#billing` with "Dodo Payments didn’t respond…" (the dummy key is rejected); remove the `DODO_*` lines and restart → buttons disabled and "Billing isn’t set up yet."
5. Dodo webhook: sign a `subscription.active` payload for your workspace id with the secret above (Standard Webhooks: `v1,` + base64 HMAC-SHA256 of `${id}.${ts}.${body}` keyed by base64-decoded `ZG9kby10ZXN0LXNpZ25pbmcta2V5`) and `curl -X POST localhost:3217/api/webhooks/dodo` with the three headers → `{"received":true,"result":"updated"}`; Settings shows Pro. The same body with a wrong signature → 401.
6. Meta callbacks: `curl -X POST localhost:3217/api/meta/data-deletion -d signed_request=<signed with your META_APP_SECRET for a user id>` → JSON `{ url, confirmation_code }`; opening the url shows the status page. A bad signature → 400.
7. `/pricing`, `/privacy`, `/terms`, `/data-deletion` render signed out; the footer links work.
8. Publish automations until the 4th on Free → the editor shows "Your Free plan allows 3 live automations…".

Stop the dev server afterwards by its PID. Leave other projects' servers and containers alone.

- [ ] **Step 3: Commit any fixes**

If a check needed a fix, commit it with a message naming the behaviour fixed. Otherwise there is nothing to commit.
