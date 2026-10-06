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
  /** Dodo Payments (spec §3.6). Billing is disabled until the key and both product IDs are set. */
  DODO_API_KEY: optional,
  DODO_WEBHOOK_SECRET: optional,
  DODO_ENVIRONMENT: z.preprocess(blank, z.enum(['test_mode', 'live_mode']).default('test_mode')),
  DODO_PRODUCT_PRO: optional,
  DODO_PRODUCT_BUSINESS: optional,
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

/** An absolute URL on the app's public origin (links in emails, OAuth and billing return URLs). */
export function appUrl(path: string): string {
  return new URL(path, env().APP_URL).toString()
}
