import { getDashboardFormatters } from '@/i18n/server-format'

import { getTranslations } from 'next-intl/server'
import { AtSign, Download, Phone, Users } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Avatar, Card, EmptyState, Keyword, PageHeader, buttonClass } from '@/components/ui'
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

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('contacts'))('pageTitle') }
}

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { formatNumber, timeAgo } = await getDashboardFormatters()
  const tr = await getTranslations('contacts')
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
    <div className="mx-auto max-w-[1180px] px-4 py-6 sm:px-10 sm:py-9">
      <PageHeader
        title={tr('contacts')}
        subtitle={tr('people_have_talked_to_leads', { v0: formatNumber(counts.total), v1: account.username, v2: formatNumber(counts.leads) })}
        actions={
          <a href={`/api/contacts/export?${exportQuery}`} className={buttonClass('secondary')}>
            <Download className="size-4" /> {tr('export_csv')}{' '}
          </a>
        }
      />

      <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={tr('total_contacts')} value={formatNumber(counts.total)} hint={tr('everyone_who_s_interacted_with_you')} />
        <StatTile
          label={tr('follow_you_back')}
          value={`${percent(counts.followsYou)}%`}
          hint={tr('of_contacts', { v0: formatNumber(counts.followsYou), v1: formatNumber(counts.total) })}
          bar={percent(counts.followsYou)}
        />
        <StatTile
          label={tr('mutual_follows')}
          value={`${percent(counts.mutual)}%`}
          hint={tr('mutual_you_both_follow', { v0: formatNumber(counts.mutual) })}
          bar={percent(counts.mutual)}
        />
        <StatTile label={tr('leads_captured')} value={formatNumber(counts.leads)} hint={tr('contacts_who_shared_an_email_or_phone')} />
      </div>

      <Card className="mt-4 overflow-hidden">
        <ContactFiltersBar tags={tags} filters={filters} />
        {contacts.length === 0 ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title={counts.total === 0 ? tr('no_contacts_yet') : tr('no_one_matches_these_filters')}
            body={
              counts.total === 0
                ? tr('everyone_who_comments_replies_or_dms_an_automation_shows_up_here')
                : tr('try_clearing_a_filter_or_searching_for_something_else')
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="eyebrow border-y border-line bg-sand/70 [&>th]:h-10 [&>th]:font-medium">
                    <th className="pl-5">{tr('contact')}</th>
                    <th>{tr('email')}</th>
                    <th>{tr('phone')}</th>
                    <th>{tr('tags')}</th>
                    <th>{tr('relationship')}</th>
                    <th>{tr('joined')}</th>
                    <th className="pr-5 text-right">{tr('last_active')}</th>
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
            </div>
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
