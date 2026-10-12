'use client'

import { useDashboardFormatters } from '@/i18n/use-format'
import { useTranslations } from 'next-intl'

import type { BioOverview } from '@replyooo/db'
import { useEffect, useState } from 'react'
import { getBioBlockDaily } from '@/app/bio-actions'
import { clickRate } from '@/lib/bio'

export function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white px-4 py-3.5">
      <div className="text-[24px] font-semibold leading-none tracking-tight">{value}</div>
      <div className="mt-1.5 text-[12.5px] text-subtle">{label}</div>
    </div>
  )
}

export function PageStats({ stats }: { stats: BioOverview }) {
  const tr = useTranslations('bio')
  const { formatNumber, formatPercent, formatDate } = useDashboardFormatters()
  return (
    <div className="mt-6 grid grid-cols-3 gap-3">
      <StatTile value={formatNumber(stats.viewsWeek)} label={tr('views_7d')} />
      <StatTile value={formatNumber(stats.clicksWeek)} label={tr('clicks_7d')} />
      <StatTile value={formatPercent(Number(clickRate(stats.clicksWeek, stats.viewsWeek)) / 100)} label={tr('ctr_7d')} />
    </div>
  )
}

/** Per-link insights: counts, rate, share of all clicks, and a 14-day bar chart loaded when opened. */
export function BlockInsights({
  blockId,
  stats,
  overview,
}: {
  blockId: string
  stats?: { clicksWeek: number; clicksAll: number }
  overview: BioOverview
}) {
  const tr = useTranslations('bio')
  const { formatNumber, formatPercent, formatDate } = useDashboardFormatters()
  const [days, setDays] = useState<{ day: string; clicks: number }[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    getBioBlockDaily(blockId).then((result) => {
      if (cancelled) return
      if (result.ok) setDays(result.days)
      else setFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [blockId])

  const week = stats?.clicksWeek ?? 0
  const all = stats?.clicksAll ?? 0
  const share = overview.clicksWeek > 0 ? Math.round((week / overview.clicksWeek) * 100) : null
  const max = Math.max(1, ...(days ?? []).map((d) => d.clicks))

  return (
    <div className="mt-3 rounded-xl bg-sand/70 p-3.5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile value={formatNumber(week)} label={tr('clicks_7_days')} />
        <StatTile value={formatNumber(all)} label={tr('all_time')} />
        <StatTile value={formatPercent(Number(clickRate(week, overview.viewsWeek)) / 100)} label={tr('ctr_page_views')} />
        <StatTile value={share === null ? '—' : formatPercent(share / 100)} label={tr('of_all_clicks_7d')} />
      </div>
      <p className="mt-3 text-[12.5px] font-medium text-muted">{tr('last_14_days')}</p>
      {failed ? (
        <p className="mt-2 text-[12.5px] text-brand">{tr('couldn_t_load_the_chart')}</p>
      ) : (
        <div className="mt-2 flex h-20 items-end gap-1" role="img" aria-label={tr('clicks_per_day_last_14_days')}>
          {(days ?? Array.from({ length: 14 }, () => ({ day: '', clicks: 0 }))).map((d, i) => (
            <div
              key={d.day || i}
              title={d.day ? tr('message_2', { v0: formatDate(d.day), v1: formatNumber(d.clicks) }) : undefined}
              className="flex h-full flex-1 items-end"
            >
              <div
                className="w-full rounded-sm bg-ink"
                style={{ height: d.clicks ? `${Math.max(8, (d.clicks / max) * 100)}%` : '3px', opacity: d.clicks ? 1 : 0.15 }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
