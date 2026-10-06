import 'server-only'
import { authAccounts, authSessions, authUsers, authVerifications, type Db } from '@replyooo/db'
import { type EmailMessage, type Mailer, passwordResetEmail, verificationEmail } from '@replyooo/email'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { nextCookies } from 'better-auth/next-js'
import { db } from './db'
import { deliver } from './email'
import { env } from './env'

export function createAuth(options: {
  db: Db
  secret: string
  baseURL: string
  google?: { clientId: string; clientSecret: string }
  /** Let server actions set cookies (app only; tests read Set-Cookie headers instead). */
  nextCookies?: boolean
  /** Where auth emails go; defaults to the app mailer (lib/email.ts). */
  mailer?: Mailer
}) {
  const send = (message: EmailMessage) => deliver(message, options.mailer)
  return betterAuth({
    secret: options.secret,
    baseURL: options.baseURL,
    database: drizzleAdapter(options.db, {
      provider: 'pg',
      schema: { user: authUsers, session: authSessions, account: authAccounts, verification: authVerifications },
    }),
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
  if (code === 'INVALID_TOKEN') return 'That reset link has expired. Request a new one.'
  return error.message || 'Something went wrong. Try again.'
}
