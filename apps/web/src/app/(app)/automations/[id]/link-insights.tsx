'use client'

import type { LinkInsight } from '@replyooo/db'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { getLinkDaily, getLinkInsights } from '@/app/actions'
import { clickRate } from '@/lib/bio'
import { useDashboardFormatters } from '@/i18n/use-format'

type Day = { day: string; clicks: number }

/** The last 14 days of clicks on one destination, loaded when its row is opened. */
function Trend({ automationId, url }: { automationId: string; url: string }) {
  const tr = useTranslations('automations')
  const [days, setDays] = useState<Day[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    getLinkDaily(automationId, url).then((result) => {
      if (cancelled) return
      if (result.ok) setDays(result.days)
      else setFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [automationId, url])

  const max = Math.max(1, ...(days ?? []).map((d) => d.clicks))
  if (failed) return <p className="mt-2 text-[12.5px] text-brand">{tr('link_chart_failed')}</p>
  return (
    <div className="mt-2 flex h-16 items-end gap-1" role="img" aria-label={tr('link_chart_label')}>
      {(days ?? Array.from({ length: 14 }, () => ({ day: '', clicks: 0 }))).map((d, i) => (
        <div key={d.day || i} title={d.day ? `${d.day}: ${d.clicks}` : undefined} className="flex h-full flex-1 items-end">
          <div className="w-full rounded-sm bg-ink" style={{ height: d.clicks ? `${Math.max(8, (d.clicks / max) * 100)}%` : '3px', opacity: d.clicks ? 1 : 0.15 }} />
        </div>
      ))}
    </div>
  )
}

/** Clicks on the links this automation sent, per destination, for the last 30 days. Renders nothing until a link has been sent. */
export function LinkInsights({ automationId }: { automationId: string }) {
  const tr = useTranslations('automations')
  const { formatNumber } = useDashboardFormatters()
  const [links, setLinks] = useState<LinkInsight[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    getLinkInsights(automationId).then((result) => {
      if (!cancelled && result.ok) setLinks(result.links)
    })
    return () => {
      cancelled = true
    }
  }, [automationId])

  if (!links || links.length === 0) return null
  return (
    <section className="mt-6 rounded-[18px] border border-line bg-white p-5" aria-labelledby="link-clicks-title">
      <h2 id="link-clicks-title" className="text-[15px] font-semibold">
        {tr('link_clicks')} <span className="font-normal text-subtle">· {tr('last_30_days_lower')}</span>
      </h2>
      <p className="mt-1 text-[12.5px] text-subtle">
        {tr('link_clicks_note')}
      </p>
      <ul className="mt-3 divide-y divide-line">
        {links.map((link) => (
          <li key={link.url} className="py-3">
            <button
              type="button"
              className="flex w-full items-center gap-3 text-left"
              aria-expanded={open === link.url}
              onClick={() => setOpen(open === link.url ? null : link.url)}
            >
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium" title={link.url}>
                {link.url}
              </span>
              <span className="shrink-0 text-[13px] tabular-nums text-subtle">
                {tr('clickers_of', { v0: formatNumber(link.clickers), v1: formatNumber(link.recipients) })} · {link.recipients > 0 ? `${clickRate(link.clickers, link.recipients)}%` : '—'}
              </span>
            </button>
            {open === link.url && (
              <div className="mt-2 rounded-xl bg-sand/70 p-3.5">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Tile value={formatNumber(link.recipients)} label={tr('people_sent')} />
                  <Tile value={formatNumber(link.clickers)} label={tr('people_clicked')} />
                  <Tile value={formatNumber(link.clicks)} label={tr('total_clicks')} />
                </div>
                <p className="mt-3 text-[12.5px] font-medium text-muted">{tr('last_14_days')}</p>
                <Trend automationId={automationId} url={link.url} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white px-3 py-2.5">
      <div className="text-[20px] font-semibold leading-none tracking-tight">{value}</div>
      <div className="mt-1 text-[12px] text-subtle">{label}</div>
    </div>
  )
}
