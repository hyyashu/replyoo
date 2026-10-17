import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

// Container healthcheck. No session; it says only whether this process can reach Postgres.
export const dynamic = 'force-dynamic'

const headers = { 'cache-control': 'no-store' }

export async function GET() {
  try {
    await db().execute(sql`select 1`)
    return Response.json({ ok: true }, { headers })
  } catch {
    return Response.json({ ok: false }, { status: 503, headers })
  }
}
