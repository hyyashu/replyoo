import 'server-only'
import { authUsers, authVerifications, type Db } from '@replyooo/db'
import { and, eq, gt, like } from 'drizzle-orm'
import type { Auth } from './auth'

/** One reset email per address per minute. */
export const RESET_COOLDOWN_MS = 60_000

/**
 * Starts a password reset unless one was already issued for this address in the last minute.
 * Better Auth's rate limiter only guards its HTTP routes, so calls made from a server action need this
 * guard, or the public form could flood someone's inbox. State lives in Better Auth's own `verification`
 * rows (identifier `reset-password:<token>`, value = user id), so it holds across instances.
 * Returns nothing: callers answer identically for unknown, throttled and sent.
 */
export async function requestPasswordResetThrottled(
  deps: { auth: Auth; db: Db },
  input: { email: string; redirectTo: string; headers?: Headers },
): Promise<void> {
  const email = input.email.trim().toLowerCase()
  const [user] = await deps.db.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.email, email)).limit(1)
  if (user) {
    const [recent] = await deps.db
      .select({ id: authVerifications.id })
      .from(authVerifications)
      .where(
        and(
          like(authVerifications.identifier, 'reset-password:%'),
          eq(authVerifications.value, user.id),
          gt(authVerifications.createdAt, new Date(Date.now() - RESET_COOLDOWN_MS)),
        ),
      )
      .limit(1)
    if (recent) return
  }
  await deps.auth.api.requestPasswordReset({ body: { email, redirectTo: input.redirectTo }, headers: input.headers })
}
