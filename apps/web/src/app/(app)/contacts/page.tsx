import { AtSign, Download, Phone, Users } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Avatar, Card, EmptyState, Keyword, PageHeader, buttonClass, formatNumber, timeAgo } from '@/components/ui'
import { parseContactFilters } from '@/lib/contact-filters'
import { CONTACTS_PAGE_SIZE, countContacts, getContactDetail, listContacts, listTags } from '@/lib/data'
import { getCurrentAccount } from '@/lib/session'
import { ContactDrawer } from './contact-drawer'
import { ContactFiltersBar } from './filters'

export const metadata: Metadata = { title: 'Contacts' }

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const filters = parseContactFilters(params)
  const { workspace, account } = await getCurrentAccount()
  const ws = workspace.workspaceId
  const [contacts, counts, tags, selected] = await Promise.all([
    listContacts(ws, account.id, filters, { limit: CONTACTS_PAGE_SIZE }),
    countContacts(ws, account.id),
    listTags(ws, account.id),
    typeof params.contact === 'string' ? getContactDetail(ws, account.id, params.contact) : null,
  ])
  const exportQuery = new URLSearchParams(Object.entries(filters).filter((e): e is [string, string] => Boolean(e[1])))

  const linkFor = (id: string) => {
    const query = new URLSearchParams(exportQuery)
    query.set('contact', id)
    return `/contacts?${query}`
  }

  return (
    <div className="mx-auto max-w-[1180px] px-10 py-9">
      <PageHeader
        title="Contacts"
        subtitle={`${formatNumber(counts.total)} people have talked to @${account.username} · ${formatNumber(counts.leads)} leads`}
        actions={
          <a href={`/api/contacts/export?${exportQuery}`} className={buttonClass('secondary')}>
            <Download className="size-4" /> Export CSV
          </a>
        }
      />

      <Card className="mt-7 overflow-hidden">
        <ContactFiltersBar tags={tags} filters={filters} />
        {contacts.length === 0 ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title={counts.total === 0 ? 'No contacts yet' : 'No one matches these filters'}
            body={
              counts.total === 0
                ? 'Everyone who comments, replies or DMs an automation shows up here.'
                : 'Try clearing a filter or searching for something else.'
            }
          />
        ) : (
          <>
            <table className="w-full text-left">
              <thead>
                <tr className="eyebrow border-y border-line bg-sand/70 [&>th]:h-10 [&>th]:font-medium">
                  <th className="pl-5">Contact</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Tags</th>
                  <th className="pr-5 text-right">Last active</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} className="h-[60px] border-b border-line text-[14px] last:border-b-0 hover:bg-sand/40">
                    <td className="pl-5">
                      <Link href={linkFor(c.id)} scroll={false} className="flex items-center gap-3">
                        <Avatar name={c.username} size={32} />
                        <span>
                          <span className="block font-semibold">{c.name}</span>
                          <span className="text-[12.5px] text-subtle">@{c.username}</span>
                        </span>
                      </Link>
                    </td>
                    <td>
                      {c.email ? (
                        <span className="inline-flex items-center gap-1.5">
                          <AtSign className="size-3.5 text-subtle" />
                          {c.email}
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td>
                      {c.phone ? (
                        <span className="inline-flex items-center gap-1.5 tabular-nums">
                          <Phone className="size-3.5 text-subtle" />
                          {c.phone}
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {c.tags.map((tag) => (
                          <Keyword key={tag}>{tag}</Keyword>
                        ))}
                      </div>
                    </td>
                    <td className="pr-5 text-right text-[13px] text-subtle">{timeAgo(c.lastInboundAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {contacts.length === CONTACTS_PAGE_SIZE && (
              <p className="border-t border-line px-5 py-3 text-[12.5px] text-subtle">
                Showing the {formatNumber(CONTACTS_PAGE_SIZE)} most recently active. Export CSV to get everyone.
              </p>
            )}
          </>
        )}
      </Card>

      {selected && <ContactDrawer contact={selected} />}
    </div>
  )
}
