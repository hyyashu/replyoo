'use client'

import type { AutomationDay, FollowUpStats } from '@replyooo/db'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { getAutomationActivity } from '@/app/actions'
import { cx } from '@/components/ui'
import { useDashboardFormatters } from '@/i18n/use-format'

type Series = 'runs' | 'dmsSent' | 'clicks'
const SERIES: Series[] = ['runs', 'dmsSent', 'clicks']

/** Conversations, DMs sent and link clicks per day for the last 30 days, plus how click follow-ups did. */
export function Activity({ automationId }: { automationId: string }) {
  const tr = useTranslations('automations')
  const { formatNumber, formatDate } = useDashboardFormatters()
  const [days, setDays] = useState<AutomationDay[] | null>(null)
  const [followUps, setFollowUps] = useState<FollowUpStats | null>(null)
  const [failed, setFailed] = useState(false)
  const [series, setSeries] = useState<Series>('runs')
  useEffect(() => {
    let cancelled = false
    getAutomationActivity(automationId).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setDays(result.days)
        setFollowUps(result.followUps)
      } else setFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [automationId])

  const label = (s: Series) => ({ runs: tr('conversations'), dmsSent: tr('dms_sent'), clicks: tr('link_clicks') })[s]
  const total = (s: Series) => (days ?? []).reduce((sum, d) => sum + d[s], 0)
  const bars = days ?? Array.from({ length: 30 }, () => ({ day: '', runs: 0, dmsSent: 0, clicks: 0 }))
  const max = Math.max(1, ...bars.map((d) => d[series]))
  const short = (day: string) => formatDate(day, { month: 'short', day: 'numeric' })

  return (
    <section className="mt-6 rounded-[18px] border border-line bg-white p-5" aria-labelledby="activity-title">
      <h2 id="activity-title" className="text-[15px] font-semibold">
        {tr('activity')} <span className="font-normal text-subtle">· {tr('last_30_days_lower')}</span>
      </h2>
      <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label={tr('activity_show')}>
        {SERIES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={series === s}
            onClick={() => setSeries(s)}
            className={cx(
              'rounded-2xl border px-3 py-2.5 text-left transition-colors',
              series === s ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:bg-sand/70',
            )}
          >
            <div className="text-[20px] font-semibold leading-none tracking-tight tabular-nums">{days ? formatNumber(total(s)) : '—'}</div>
            <div className={cx('mt-1 text-[12px]', series === s ? 'text-white/70' : 'text-subtle')}>{label(s)}</div>
          </button>
        ))}
      </div>
      {failed ? (
        <p className="mt-3 text-[12.5px] text-brand">{tr('link_chart_failed')}</p>
      ) : (
        <>
          <div className="mt-4 flex h-24 items-end gap-[3px]" role="img" aria-label={tr('activity_chart_label', { series: label(series) })}>
            {bars.map((d, i) => (
              <div
                key={d.day || i}
                title={d.day ? `${short(d.day)}: ${formatNumber(d[series])}` : undefined}
                className="flex h-full flex-1 items-end"
              >
                <div
                  className="w-full rounded-sm bg-ink"
                  style={{ height: d[series] ? `${Math.max(8, (d[series] / max) * 100)}%` : '3px', opacity: d[series] ? 1 : 0.15 }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[11.5px] text-subtle">
            <span>{days ? short(days[0]!.day) : ' '}</span>
            <span>{tr('today')}</span>
          </div>
        </>
      )}
      {followUps && followUps.sent + followUps.skippedClicked > 0 && (
        <p className="mt-4 border-t border-line pt-3 text-[13px] text-muted">
          <span className="font-medium text-ink">{tr('follow_ups')}:</span>{' '}
          {[
            tr('follow_ups_sent', { count: followUps.sent }),
            tr('follow_ups_opened', { count: followUps.opened }),
            tr('follow_ups_not_needed', { count: followUps.skippedClicked }),
          ].join(' · ')}
        </p>
      )}
    </section>
  )
}
