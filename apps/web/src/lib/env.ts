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
