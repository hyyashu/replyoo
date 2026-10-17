/**
 * Runs once when the server starts, before it handles requests. Most config is read lazily (env() in lib/env.ts) so
 * `next build` needs no secrets; the settings checked here would otherwise only fail on the first request that
 * touches them, so a bad deploy should refuse to start instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { parseEncryptionKey, parsePoolMax } = await import('@replyooo/db')
  parseEncryptionKey(process.env.TOKEN_ENCRYPTION_KEY ?? '')
  parsePoolMax(process.env.DATABASE_POOL_MAX)
}
