'use client'

import { Loader2, RotateCw, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { getLatestRerun, previewRerun, startRerun } from '@/app/actions'
import { buttonClass, cx } from '@/components/ui'
import { useDashboardFormatters } from '@/i18n/use-format'
import type { RerunErrorCode, RerunPreview, RerunRun } from '@/lib/data'
import { RERUN_WINDOWS, rerunFailureKey } from '@/lib/rerun'

type Failure = { code: RerunErrorCode | 'network'; message: string }
type PreviewState = { kind: 'loading' } | { kind: 'error'; failure: Failure } | { kind: 'ready'; preview: RerunPreview }

const POLL_MS = 5000
const RUN_CAP = 500

function useErrorText() {
  const tr = useTranslations('automations')
  return (failure: Failure) => tr(`rerun_error_${failure.code}`)
}

/** Reply to comments that already exist on this automation's posts. Shown for live comment automations. */
export function RerunSection({ automationId }: { automationId: string }) {
  const tr = useTranslations('automations')
  const { formatNumber } = useDashboardFormatters()
  const [latest, setLatest] = useState<RerunRun | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    getLatestRerun(automationId).then((result) => {
      if (!cancelled) setLatest(result.run)
    })
    return () => {
      cancelled = true
    }
  }, [automationId])

  const active = latest?.status === 'queued' || latest?.status === 'running'
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      getLatestRerun(automationId).then((result) => setLatest(result.run))
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [active, automationId])

  return (
    <section className="mt-6 rounded-[18px] border border-line bg-white p-5" aria-labelledby="rerun-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="rerun-title" className="text-[15px] font-semibold">
            {tr('rerun_title')}
          </h2>
          <p className="mt-1 text-[12.5px] text-subtle">{tr('rerun_intro')}</p>
        </div>
        <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => setOpen(true)} disabled={active}>
          <RotateCw className="size-4" aria-hidden /> {tr('rerun_button')}
        </button>
      </div>

      {latest && (
        <div className="mt-4 rounded-xl bg-sand px-4 py-3 text-[13px]" aria-live="polite">
          <p className="font-medium">
            {tr('rerun_last_run')} · {tr(`rerun_status_${latest.status}`)}
            {active && <Loader2 className="ml-2 inline size-3.5 animate-spin align-[-2px]" aria-hidden />}
          </p>
          {latest.status === 'done' && (
            <p className="mt-1 text-muted">
              {tr('rerun_summary', {
                v0: formatNumber(latest.found),
                v1: formatNumber(latest.enqueued),
                v2: formatNumber(latest.skippedHandled),
                v3: formatNumber(latest.skippedNoMatch),
              })}
            </p>
          )}
          {latest.status === 'done' && latest.capped && <p className="mt-1 text-muted">{tr('rerun_capped_note', { v0: formatNumber(RUN_CAP) })}</p>}
          {latest.status === 'failed' && <p className="mt-1 text-brand">{tr(rerunFailureKey(latest.error))}</p>}
        </div>
      )}

      {open && (
        <RerunDialog
          automationId={automationId}
          onClose={() => setOpen(false)}
          onStarted={(run) => {
            setLatest(run)
            setOpen(false)
          }}
        />
      )}
    </section>
  )
}

function RerunDialog({
  automationId,
  onClose,
  onStarted,
}: {
  automationId: string
  onClose: () => void
  onStarted: (run: RerunRun) => void
}) {
  const tr = useTranslations('automations')
  const shared = useTranslations('shared')
  const { formatNumber } = useDashboardFormatters()
  const errorText = useErrorText()
  const [windowHours, setWindowHours] = useState<(typeof RERUN_WINDOWS)[number]>(72)
  const [preview, setPreview] = useState<PreviewState>({ kind: 'loading' })
  const [startError, setStartError] = useState<Failure | null>(null)
  const [starting, startTransition] = useTransition()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    setPreview({ kind: 'loading' })
    setStartError(null)
    previewRerun(automationId, windowHours)
      .then((result) => {
        if (cancelled) return
        setPreview(
          result.ok ? { kind: 'ready', preview: result.preview } : { kind: 'error', failure: { code: result.code, message: result.message } },
        )
      })
      .catch(() => {
        if (!cancelled) setPreview({ kind: 'error', failure: { code: 'network', message: '' } })
      })
    return () => {
      cancelled = true
    }
  }, [automationId, windowHours])

  const canStart = preview.kind === 'ready' && preview.preview.eligible > 0 && !starting

  const start = () =>
    startTransition(async () => {
      try {
        const result = await startRerun(automationId, windowHours)
        if (result.ok) onStarted(result.run)
        else setStartError({ code: result.code, message: result.message })
      } catch {
        setStartError({ code: 'network', message: '' })
      }
    })

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={tr('rerun_title')}>
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full max-w-[460px] rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[16px] font-semibold">{tr('rerun_title')}</h2>
          <button type="button" aria-label={shared('close')} onClick={onClose} className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-sand">
            <X className="size-4" />
          </button>
        </div>

        <fieldset className="mt-4">
          <legend className="text-[12.5px] font-medium text-muted">{tr('rerun_window')}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {RERUN_WINDOWS.map((hours) => (
              <label
                key={hours}
                className={cx(
                  'cursor-pointer rounded-full border px-3 py-1.5 text-[13px] font-medium',
                  windowHours === hours ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:bg-sand',
                )}
              >
                <input type="radio" name="rerun-window" className="sr-only" checked={windowHours === hours} onChange={() => setWindowHours(hours)} />
                {tr(`rerun_window_${hours}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-4 min-h-[44px] text-[13px]" aria-live="polite">
          {preview.kind === 'loading' && (
            <p className="flex items-center gap-2 text-subtle">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> {tr('rerun_checking')}
            </p>
          )}
          {preview.kind === 'error' && <p className="text-brand">{errorText(preview.failure)}</p>}
          {preview.kind === 'ready' && (
            <p className={preview.preview.eligible > 0 ? 'text-ink' : 'text-muted'}>
              {preview.preview.found > 0
                ? tr('rerun_preview', {
                    v0: formatNumber(preview.preview.found),
                    v1: formatNumber(preview.preview.eligible),
                    v2: formatNumber(preview.preview.handled),
                  })
                : tr('rerun_preview_none')}
            </p>
          )}
          {preview.kind === 'ready' && preview.preview.capped && (
            <p className="mt-1 text-subtle">{tr('rerun_preview_capped', { v0: formatNumber(RUN_CAP) })}</p>
          )}
          {startError && <p className="mt-1 text-brand">{errorText(startError)}</p>}
        </div>

        <p className="mt-2 text-[12px] text-subtle">{tr('rerun_published_only')}</p>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={buttonClass('secondary', 'sm')} onClick={onClose}>
            {shared('cancel')}
          </button>
          <button type="button" className={buttonClass('primary', 'sm')} onClick={start} disabled={!canStart}>
            {starting ? tr('rerun_starting') : tr('rerun_start')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
