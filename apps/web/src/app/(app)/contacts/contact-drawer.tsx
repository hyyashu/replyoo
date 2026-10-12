'use client'

import { useDashboardFormatters } from '@/i18n/use-format'

import { useTranslations } from 'next-intl'

import { AtSign, Phone, X } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { Avatar, Keyword, cx } from '@/components/ui'
import type { ContactDetail, ContactRun } from '@/lib/data/types'
import { RelationshipBadges } from './relationship'

const RUN_STATUS: Record<ContactRun['status'], string> = {
  running: 'bg-sky-soft text-[#1f5f99]',
  waiting: 'bg-amber-soft text-[#8a4b0f]',
  completed: 'bg-lime-soft text-lime-ink',
  failed: 'bg-brand-soft text-[#a12b0b]',
  expired: 'bg-cream text-muted',
  cancelled: 'bg-cream text-muted',
}

export function ContactDrawer({ contact }: { contact: ContactDetail }) {
  const { formatDate, timeAgo } = useDashboardFormatters()
  const tr = useTranslations('contacts')
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const close = () => {
    const next = new URLSearchParams(params)
    next.delete('contact')
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label={tr('close')} onClick={close} className="absolute inset-0 bg-ink/20" />
      <aside className="relative flex h-full w-[440px] max-w-full flex-col overflow-y-auto bg-white shadow-[-12px_0_40px_rgba(21,19,16,0.12)]">
        <div className="flex items-start gap-3 border-b border-line p-6">
          <Avatar name={contact.username} size={48} src={contact.avatarUrl} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-semibold">{contact.name}</h2>
            <p className="text-[13.5px] text-subtle">@{contact.username}</p>
            <RelationshipBadges followsYou={contact.followsYou} youFollow={contact.youFollow} className="mt-2" />
          </div>
          <button type="button" onClick={close} aria-label={tr('close')} className="grid size-8 place-items-center rounded-lg hover:bg-sand">
            <X className="size-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 border-b border-line p-6">
          {[
            [tr('messages'), String(contact.messageCount)],
            [tr('firstInteraction'), formatDate(contact.firstSeenAt, { month: 'short', day: 'numeric', year: 'numeric' })],
            [tr('lastActivity'), timeAgo(contact.lastInboundAt)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-line px-3 py-2.5">
              <div className="eyebrow text-[10.5px]">{label}</div>
              <div className="mt-1 text-[14px] font-semibold">{value}</div>
            </div>
          ))}
        </div>

        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-3 border-b border-line p-6 text-[13.5px]">
          <dt className="text-subtle">{tr('email')}</dt>
          <dd className="flex items-center gap-1.5">
            {contact.email ? (
              <>
                <AtSign className="size-3.5 text-subtle" /> {contact.email}
              </>
            ) : (
              <span className="text-faint">—</span>
            )}
          </dd>
          <dt className="text-subtle">{tr('phone')}</dt>
          <dd className="flex items-center gap-1.5">
            {contact.phone ? (
              <>
                <Phone className="size-3.5 text-subtle" /> {contact.phone}
              </>
            ) : (
              <span className="text-faint">—</span>
            )}
          </dd>
          {Object.entries(contact.fields).map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="font-mono text-[12px] text-subtle">{tr('fields', { v0: key })}</dt>
              <dd>{value}</dd>
            </div>
          ))}
          <dt className="text-subtle">{tr('tags')}</dt>
          <dd className="flex flex-wrap gap-1">
            {contact.tags.length ? contact.tags.map((tag) => <Keyword key={tag}>{tag}</Keyword>) : <span className="text-faint">—</span>}
          </dd>
        </dl>

        <section className="border-b border-line p-6">
          <h3 className="eyebrow">{tr('run_history')}</h3>
          <ul className="mt-3 flex flex-col gap-2">
            {contact.runs.map((run, index) => (
              <li key={index} className="flex items-center justify-between gap-3 text-[13.5px]">
                <span className="truncate font-medium">{run.automationName}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className={cx('rounded-full px-2 py-0.5 text-[11.5px] font-semibold capitalize', RUN_STATUS[run.status])}>
                    {tr(`run_${run.status}`)}
                  </span>
                  <span className="w-16 text-right text-[12px] text-subtle">{timeAgo(run.at)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="p-6">
          <h3 className="eyebrow">{tr('messages')}</h3>
          <div className="mt-4 flex flex-col gap-2">
            {[...contact.messages]
              .sort((a, b) => a.at.localeCompare(b.at))
              .map((m, index) => (
                <div
                  key={index}
                  className={cx(
                    'max-w-[82%] rounded-[16px] px-3 py-2 text-[13px] leading-snug',
                    m.direction === 'out' ? 'self-end bg-violet text-white' : 'self-start bg-[#efefef]',
                  )}
                >
                  {m.text}
                </div>
              ))}
          </div>
        </section>
      </aside>
    </div>
  )
}
