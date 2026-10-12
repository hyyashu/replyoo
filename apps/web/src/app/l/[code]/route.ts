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
  return new Response(null, { status: 302, headers: { Location: new URL(link.url).href, 'Cache-Control': 'no-store' } })
}

/** Short link from a DM button: counts the tap, then sends the person to the real destination. */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  return open(request, (await params).code, true)
}

/** Previewers often probe with HEAD first; those must not count as clicks. */
export async function HEAD(request: Request, { params }: { params: Promise<{ code: string }> }) {
  return open(request, (await params).code, false)
}
