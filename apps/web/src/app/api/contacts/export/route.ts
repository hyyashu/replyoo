import { parseContactFilters } from '@/lib/contact-filters'
import { listContacts } from '@/lib/data'
import { getCurrentAccount } from '@/lib/session'

const COLUMNS = ['username', 'name', 'email', 'phone', 'tags', 'first_seen_at', 'last_active_at'] as const

/** Quote every cell and neutralise spreadsheet formula injection. */
function cell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

export async function GET(request: Request) {
  const { account } = await getCurrentAccount()
  const contacts = await listContacts(account.id, parseContactFilters(new URL(request.url).searchParams))
  const rows = contacts.map((c) =>
    [c.username, c.name, c.email ?? '', c.phone ?? '', c.tags.join(' '), c.firstSeenAt, c.lastInboundAt].map(cell).join(','),
  )
  const csv = [COLUMNS.join(','), ...rows].join('\r\n')
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="contacts-${account.username}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
