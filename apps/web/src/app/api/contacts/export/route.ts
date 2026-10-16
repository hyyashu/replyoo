import { parseContactFilters } from '@/lib/contact-filters'
import { csvContentDisposition, csvRow } from '@/lib/csv'
import { type Contact, listContacts } from '@/lib/data'
import { getCurrentAccount } from '@/lib/session'

const COLUMNS = ['username', 'name', 'email', 'phone', 'tags', 'follows_you', 'you_follow', 'first_seen_at', 'last_active_at'] as const
/** Contacts read per query, so a big list streams instead of sitting in memory. */
const PAGE_SIZE = 1000

const yesNo = (value: boolean | null) => (value === null ? '' : value ? 'yes' : 'no')

const toRow = (c: Contact) => [c.username, c.name, c.email ?? '', c.phone ?? '', c.tags.join(' '), yesNo(c.followsYou), yesNo(c.youFollow), c.firstSeenAt, c.lastInboundAt]

export async function GET(request: Request) {
  const { workspace, account } = await getCurrentAccount()
  const filters = parseContactFilters(new URL(request.url).searchParams)
  const encoder = new TextEncoder()
  let offset = 0
  let done = false
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(COLUMNS.join(',')))
    },
    async pull(controller) {
      if (done) return controller.close()
      const page = await listContacts(workspace.workspaceId, account.id, filters, { limit: PAGE_SIZE, offset })
      offset += page.length
      done = page.length < PAGE_SIZE
      if (page.length > 0) controller.enqueue(encoder.encode(page.map((c) => `\r\n${csvRow(toRow(c))}`).join('')))
      if (done) controller.close()
    },
  })
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': csvContentDisposition('contacts', account.username, new Date().toISOString().slice(0, 10)),
    },
  })
}
