import { AtSign, Download, Phone, Users } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Avatar, Card, EmptyState, Keyword, PageHeader, buttonClass, formatNumber, timeAgo } from '@/components/ui'
import { parseContactFilters } from '@/lib/contact-filters'
import {
  CONTACT_PAGE_SIZES,
  DEFAULT_CONTACT_PAGE_SIZE,
  contactStats,
  countMatchingContacts,
  getContactDetail,
  listContacts,
  listTags,
} from '@/lib/data'
import { getCurrentAccount } from '@/lib/session'
import { ContactDrawer } from './contact-drawer'
import { ContactFiltersBar } from './filters'
import { Pager } from './pager'
import { RelationshipBadges } from './relationship'

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
  const sizeParam = Number(typeof params.size === 'string' ? params.size : '')
  const size = CONTACT_PAGE_SIZES.find((value) => value === sizeParam) ?? DEFAULT_CONTACT_PAGE_SIZE
  const matching = await countMatchingContacts(ws, account.id, filters)
  const pages = Math.max(1, Math.ceil(matching / size))
  const pageParam = Math.floor(Number(typeof params.page === 'string' ? params.page : '1'))
  const page = Math.min(pages, Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1)
  const [contacts, counts, tags, selected] = await Promise.all([
    listContacts(ws, account.id, filters, { limit: size, offset: (page - 1) * size }),
    contactStats(ws, account.id),
    listTags(ws, account.id),
    typeof params.contact === 'string' ? getContactDetail(ws, account.id, params.contact) : null,
  ])
  const percent = (part: number) => (counts.total === 0 ? 0 : Math.round((part / counts.total) * 100))
  const exportQuery = new URLSearchParams(Object.entries(filters).filter((e): e is [string, string] => Boolean(e[1])))

  const linkFor = (id: string) => {
    const query = new URLSearchParams(exportQuery)
    if (page > 1) query.set('page', String(page))
    if (size !== DEFAULT_CONTACT_PAGE_SIZE) query.set('size', String(size))
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

      <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Total contacts" value={formatNumber(counts.total)} hint="Everyone who's interacted with you" />
        <StatTile
          label="Follow you back"
          value={`${percent(counts.followsYou)}%`}
          hint={`${formatNumber(counts.followsYou)} of ${formatNumber(counts.total)} contacts`}
          bar={percent(counts.followsYou)}
        />
        <StatTile
          label="Mutual follows"
          value={`${percent(counts.mutual)}%`}
          hint={`${formatNumber(counts.mutual)} mutual · you both follow`}
          bar={percent(counts.mutual)}
        />
        <StatTile label="Leads captured" value={formatNumber(counts.leads)} hint="Contacts who shared an email or phone" />
      </div>

      <Card className="mt-4 overflow-hidden">
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
                  <th>Relationship</th>
                  <th>Joined</th>
                  <th className="pr-5 text-right">Last active</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} className="h-[60px] border-b border-line text-[14px] last:border-b-0 hover:bg-sand/40">
                    <td className="pl-5">
                      <Link href={linkFor(c.id)} scroll={false} className="flex items-center gap-3">
                        <Avatar name={c.username} size={32} src={c.avatarUrl} />
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
                    <td>
                      <RelationshipBadges followsYou={c.followsYou} youFollow={c.youFollow} />
                    </td>
                    <td className="text-[13px] text-subtle">{timeAgo(c.firstSeenAt)}</td>
                    <td className="pr-5 text-right text-[13px] text-subtle">{timeAgo(c.lastInboundAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager page={page} pages={pages} total={matching} size={size} sizes={CONTACT_PAGE_SIZES} />
          </>
        )}
      </Card>

      {selected && <ContactDrawer contact={selected} />}
    </div>
  )
}

function StatTile({ label, value, hint, bar }: { label: string; value: string; hint: string; bar?: number }) {
  return (
    <Card className="p-5">
      <div className="eyebrow">{label}</div>
      <div className="mt-1.5 text-[28px] font-semibold leading-none tracking-tight">{value}</div>
      {bar !== undefined && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-sand">
          <div className="h-full rounded-full bg-ink" style={{ width: `${bar}%` }} />
        </div>
      )}
      <p className="mt-2 text-[12.5px] text-subtle">{hint}</p>
    </Card>
  )
}
