import { getBioPageBySlug, listBioBlocks, recordBioEvent } from '@replyooo/db'
import { isBotUserAgent, isSafeHttpUrl } from '@/lib/bio'
import { isUuid } from '@/lib/data/ids'
import { db } from '@/lib/db'

/** Click redirect: counts the click for the link's insights, then sends the visitor on. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string; blockId: string }> }) {
  const { slug, blockId } = await params
  if (!isUuid(blockId)) return new Response('Not found', { status: 404 })
  const page = await getBioPageBySlug(db(), slug.toLowerCase())
  const block = page ? (await listBioBlocks(db(), page.id)).find((b) => b.id === blockId) : undefined
  const url = block?.config.url
  if (!page || !block || block.type !== 'link' || block.hidden || !isSafeHttpUrl(url)) {
    return new Response('Not found', { status: 404 })
  }
  if (!isBotUserAgent(request.headers.get('user-agent'))) {
    // A failed count must never stop the visitor reaching the link.
    await recordBioEvent(db(), { pageId: page.id, blockId: block.id, type: 'click' }).catch(() => {})
  }
  return Response.redirect(url!, 302)
}
