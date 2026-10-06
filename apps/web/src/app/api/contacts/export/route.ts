import { parseContactFilters } from '@/lib/contact-filters'
import { csvContentDisposition, toCsv } from '@/lib/csv'
import { listContacts } from '@/lib/data'
import { getCurrentAccount } from '@/lib/session'

const COLUMNS = ['username', 'name', 'email', 'phone', 'tags', 'first_seen_at', 'last_active_at'] as const

export async function GET(request: Request) {
  const { workspace, account } = await getCurrentAccount()
  const contacts = await listContacts(workspace.workspaceId, account.id, parseContactFilters(new URL(request.url).searchParams))
  const csv = toCsv(
    COLUMNS,
    contacts.map((c) => [c.username, c.name, c.email ?? '', c.phone ?? '', c.tags.join(' '), c.firstSeenAt, c.lastInboundAt]),
  )
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': csvContentDisposition('contacts', account.username, new Date().toISOString().slice(0, 10)),
    },
  })
}
