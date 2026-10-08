'use client'

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
  return (
    <div className="mt-6 grid grid-cols-3 gap-3">
      <StatTile value={String(stats.viewsWeek)} label="Views · 7d" />
      <StatTile value={String(stats.clicksWeek)} label="Clicks · 7d" />
      <StatTile value={`${clickRate(stats.clicksWeek, stats.viewsWeek)}%`} label="CTR · 7d" />
    </div>
  )
}

/** Per-link insights: counts, rate, share of all clicks, and a 14-day bar chart loaded when opened. */
export function BlockInsights({ blockId, stats, overview }: { blockId: string; stats?: { clicksWeek: number; clicksAll: number }; overview: BioOverview }) {
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
        <StatTile value={String(week)} label="Clicks · 7 days" />
        <StatTile value={String(all)} label="All time" />
        <StatTile value={`${clickRate(week, overview.viewsWeek)}%`} label="CTR · page views" />
        <StatTile value={share === null ? '—' : `${share}%`} label="Of all clicks · 7d" />
      </div>
      <p className="mt-3 text-[12.5px] font-medium text-muted">Last 14 days</p>
      {failed ? (
        <p className="mt-2 text-[12.5px] text-brand">Couldn’t load the chart.</p>
      ) : (
        <div className="mt-2 flex h-20 items-end gap-1" role="img" aria-label="Clicks per day, last 14 days">
          {(days ?? Array.from({ length: 14 }, () => ({ day: '', clicks: 0 }))).map((d, i) => (
            <div key={d.day || i} title={d.day ? `${d.day}: ${d.clicks}` : undefined} className="flex h-full flex-1 items-end">
              <div className="w-full rounded-sm bg-ink" style={{ height: d.clicks ? `${Math.max(8, (d.clicks / max) * 100)}%` : '3px', opacity: d.clicks ? 1 : 0.15 }} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
