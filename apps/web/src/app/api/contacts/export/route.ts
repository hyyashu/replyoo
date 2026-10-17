import { parseContactFilters } from '@/lib/contact-filters'
import { csvContentDisposition, csvRow } from '@/lib/csv'
import { type Contact, listContacts } from '@/lib/data'
import { db } from '@/lib/db'
import { openReadSnapshot } from '@/lib/db-snapshot'
import { getCurrentAccount } from '@/lib/session'

const COLUMNS = ['username', 'name', 'email', 'phone', 'tags', 'follows_you', 'you_follow', 'first_seen_at', 'last_active_at'] as const
/** Contacts read per query, so a big list streams instead of sitting in memory. */
const PAGE_SIZE = 1000
/** Each export holds a database connection for as long as the download runs. */
const MAX_CONCURRENT_EXPORTS = 2
let activeExports = 0

const yesNo = (value: boolean | null) => (value === null ? '' : value ? 'yes' : 'no')

const toRow = (c: Contact) => [c.username, c.name, c.email ?? '', c.phone ?? '', c.tags.join(' '), yesNo(c.followsYou), yesNo(c.youFollow), c.firstSeenAt, c.lastInboundAt]

const toCsv = (page: Contact[]) => page.map((c) => `\r\n${csvRow(toRow(c))}`).join('')

export async function GET(request: Request) {
  const { workspace, account } = await getCurrentAccount()
  const filters = parseContactFilters(new URL(request.url).searchParams)
  if (activeExports >= MAX_CONCURRENT_EXPORTS) return new Response('Too many exports running, try again shortly', { status: 429 })

  activeExports++
  let snapshot: Awaited<ReturnType<typeof openReadSnapshot>>
  try {
    snapshot = await openReadSnapshot(db())
  } catch (err) {
    activeExports--
    console.error('[contacts-export] could not open snapshot', err)
    return new Response('Export failed', { status: 500 })
  }
  void snapshot.closed.then(() => activeExports--)
  const { tx, end } = snapshot
  const read = (offset: number) => listContacts(workspace.workspaceId, account.id, filters, { limit: PAGE_SIZE, offset, executor: tx })

  let first: Contact[]
  try {
    first = await read(0)
  } catch (err) {
    await end(err)
    console.error('[contacts-export] export failed', err)
    return new Response('Export failed', { status: 500 })
  }
  let offset = first.length
  let done = first.length < PAGE_SIZE
  if (done) void end()
  request.signal.addEventListener('abort', () => void end(request.signal.reason), { once: true })

  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(COLUMNS.join(',') + toCsv(first)))
      if (done) controller.close()
    },
    async pull(controller) {
      let page: Contact[]
      try {
        page = await read(offset)
      } catch (err) {
        await end(err)
        console.error('[contacts-export] export failed mid-stream', err)
        return controller.error(err)
      }
      offset += page.length
      done = page.length < PAGE_SIZE
      if (page.length > 0) controller.enqueue(encoder.encode(toCsv(page)))
      if (done) {
        await end()
        controller.close()
      }
    },
    async cancel(reason) {
      await end(reason ?? new Error('export cancelled'))
    },
  })
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': csvContentDisposition('contacts', account.username, new Date().toISOString().slice(0, 10)),
    },
  })
}
