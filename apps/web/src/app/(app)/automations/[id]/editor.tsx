'use client'

import { stepTargets, type Platform } from '@replyooo/shared'
import { ArrowLeft, Check, CircleAlert, LoaderCircle, Pause, Pencil, Play } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { publishAutomation, saveDraft, setAutomationStatus } from '@/app/actions'
import { Button, StatusPill, cx, formatNumber, formatPercent, timeAgo } from '@/components/ui'
import type { Automation } from '@/lib/data/types'
import { recipeFromFlow, type Recipe } from '@/lib/recipe'
import { checkRecipe, type RecipeSection } from '@/lib/validation'
import { Segmented } from './fields'
import { PhonePreview } from '@/components/phone-preview'
import { BoostersSection, DmSection, PublicReplySection, TriggerSection, type Update } from './sections'

type SaveState = { kind: 'saved'; at: string } | { kind: 'saving' } | { kind: 'error'; message: string }
type SaveResult = { ok: true; savedAt: string } | { ok: false; error: string; conflict?: boolean }

const savedNow = (): SaveState => ({ kind: 'saved', at: new Date().toISOString() })
const NETWORK_ERROR = "Couldn't reach Replyooo. Check your connection and try again."

export function Editor({
  automation,
  platform,
  username,
}: {
  automation: Automation
  platform: Platform
  username: string
}) {
  const [name, setName] = useState(automation.name)
  const [recipe, setRecipe] = useState<Recipe>(() => recipeFromFlow(automation.flow))
  const [status, setStatus] = useState(automation.status)
  // Whether the draft differs from the published version; the server says so on load, edits set it.
  const [unpublished, setUnpublished] = useState(automation.hasUnpublishedChanges)
  const [save, setSave] = useState<SaveState>({ kind: 'saved', at: automation.updatedAt })
  const [publishErrors, setPublishErrors] = useState<string[]>([])
  const [published, setPublished] = useState(false)
  const [preview, setPreview] = useState<'comment' | 'dm'>('dm')
  const [publishing, startPublish] = useTransition()
  const [statusPending, startStatus] = useTransition()
  const [conflict, setConflict] = useState(false)
  const [saveAttempt, setSaveAttempt] = useState(0)
  const router = useRouter()

  const { flow, issues } = useMemo(() => checkRecipe(recipe, platform), [recipe, platform])
  const sectionIssues = (section: RecipeSection) => issues.filter((issue) => issue.section === section)

  const update: Update = (fn) => {
    setRecipe((current) => {
      const next = structuredClone(current)
      fn(next)
      return next
    })
    setUnpublished(true)
    setPublished(false)
    setPublishErrors([])
  }

  const snapshot = JSON.stringify({ name, flow })
  const latest = useRef(snapshot)
  latest.current = snapshot
  const lastSaved = useRef(snapshot)
  // The draft as the server last stored it. The server refuses a save whose base no longer matches (another tab saved).
  const baseFlow = useRef<unknown>(automation.flow)
  // Every save and publish goes through one queue so two requests can never reach the server out of order.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const inFlight = useRef(0)
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(task)
    queue.current = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  const saveSnapshot = (snap: string): Promise<SaveResult> => {
    const { name: savedName, flow: savedFlow } = JSON.parse(snap) as { name: string; flow: unknown }
    return enqueue(async (): Promise<SaveResult> => {
      // An earlier request in the queue (a publish, or the same autosave) may already have stored this exact draft.
      if (lastSaved.current === snap) return { ok: true, savedAt: new Date().toISOString() }
      inFlight.current++
      try {
        const result = await saveDraft(automation.id, savedName, savedFlow, baseFlow.current)
        if (result.ok) {
          baseFlow.current = savedFlow
          lastSaved.current = snap
        }
        return result
      } catch {
        return { ok: false, error: NETWORK_ERROR }
      } finally {
        inFlight.current--
      }
    })
  }

  // Debounced autosave of the draft whenever it differs from what was last saved.
  useEffect(() => {
    if (conflict) return
    if (snapshot === lastSaved.current) {
      // Edited back to what's saved: nothing to send. A request still in flight settles the status when it returns.
      if (inFlight.current === 0) setSave((current) => (current.kind === 'saving' ? savedNow() : current))
      return
    }
    setSave({ kind: 'saving' })
    const timer = setTimeout(async () => {
      if (snapshot === lastSaved.current) return setSave(savedNow())
      const result = await saveSnapshot(snapshot)
      if (!result.ok && result.conflict) setConflict(true)
      if (latest.current !== snapshot) {
        // Edited again while this was in flight. If that edit reverted to the old saved value its effect did nothing,
        // so run the effect again to save it (or settle the status) now that this request is done.
        setSaveAttempt((n) => n + 1)
        return
      }
      setSave(result.ok ? { kind: 'saved', at: result.savedAt } : { kind: 'error', message: result.error })
    }, 700)
    return () => clearTimeout(timer)
    // saveSnapshot only reads refs and the (constant) automation id.
  }, [automation.id, snapshot, saveAttempt, conflict])

  // Leaving through a link elsewhere in the app (no beforeunload) unmounts this page; send the edit still waiting on the debounce.
  useEffect(
    () => () => {
      if (latest.current !== lastSaved.current) void saveSnapshot(latest.current)
    },
    // saveSnapshot only reads refs and the (constant) automation id.
    [],
  )

  // Come back online: retry a save that failed because we were offline.
  const failed = save.kind === 'error' && !conflict
  useEffect(() => {
    if (!failed) return
    const retry = () => setSaveAttempt((n) => n + 1)
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [failed])

  const hasUnsavedWork = () => inFlight.current > 0 || latest.current !== lastSaved.current
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedWork()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  // Leaving through the back link waits for the pending save instead of dropping it.
  const goBack = async (event: React.MouseEvent) => {
    if (!hasUnsavedWork() || conflict) return
    event.preventDefault()
    setSave({ kind: 'saving' })
    const result = await saveSnapshot(latest.current)
    if (result.ok) return router.push('/automations')
    if (result.conflict) setConflict(true)
    setSave({ kind: 'error', message: result.error })
  }

  const publish = () =>
    startPublish(async () => {
      const snap = snapshot
      inFlight.current++
      try {
        const result = await enqueue(() => publishAutomation(automation.id, name, flow, baseFlow.current))
        if (result.ok) {
          baseFlow.current = flow
          lastSaved.current = snap
          setStatus('active')
          // An edit made while this ran isn't published yet; its own save settles the status.
          if (latest.current === snap) {
            setUnpublished(false)
            setPublished(true)
            setSave(savedNow())
          }
        } else {
          // The draft was stored before the publish checks ran, unless the save itself was refused.
          if ('saved' in result && result.saved) {
            baseFlow.current = flow
            lastSaved.current = snap
            if (latest.current === snap) setSave(savedNow())
          }
          if ('conflict' in result && result.conflict) setConflict(true)
          setPublishErrors(result.errors)
        }
      } catch {
        setPublishErrors([NETWORK_ERROR])
      } finally {
        inFlight.current--
      }
    })

  const toggleLive = () => {
    if (publishing || statusPending) return
    const previous = status
    const next = status === 'active' ? 'paused' : 'active'
    setStatus(next)
    startStatus(async () => {
      try {
        const result = await setAutomationStatus(automation.id, next)
        if (!result.ok) {
          setStatus(previous)
          setPublishErrors([result.error])
        }
      } catch {
        setStatus(previous)
        setPublishErrors([NETWORK_ERROR])
      }
    })
  }

  const isIceBreaker = recipe.trigger.type === 'ice_breaker'
  const hasPublicReply = recipe.trigger.type === 'comment_keyword'
  const stepCount = Object.keys(flow.steps).length
  const branchCount = Object.values(flow.steps).filter((step) => new Set(stepTargets(step)).size > 1).length
  const canPublish = issues.length === 0 && !publishing && !conflict && (unpublished || status === 'draft')
  const { stats } = automation

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line bg-white/95 px-4 py-4 backdrop-blur sm:px-8">
        <Link
          href="/automations"
          onClick={goBack}
          aria-label="Back to automations"
          className="grid size-10 place-items-center rounded-xl border border-line hover:bg-sand"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0">
          <div className="text-[12.5px] text-subtle">Automations</div>
          <div className="flex items-center gap-2.5">
            <label className="group flex items-center gap-1.5">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Automation name"
                className="field-sizing-content min-w-[8ch] max-w-[420px] rounded-md bg-transparent font-display text-[20px] font-bold tracking-[-0.03em] outline-none focus:bg-sand"
              />
              <Pencil className="size-3.5 text-faint group-hover:text-muted" />
            </label>
            <StatusPill status={status} />
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
          <SaveIndicator
            state={save}
            conflict={conflict}
            onRetry={() => setSaveAttempt((n) => n + 1)}
          />
          {status !== 'draft' && (
            <Button variant="secondary" onClick={toggleLive} disabled={publishing || statusPending}>
              {status === 'active' ? <Pause className="size-4" /> : <Play className="size-4" />}
              {status === 'active' ? 'Pause' : 'Resume'}
            </Button>
          )}
          <Button
            className="min-w-[168px] justify-center"
            onClick={publish}
            disabled={!canPublish}
            title={issues.length ? 'Fix the issues below first' : undefined}
          >
            {publishing ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : published ? (
              <>
                Published <Check className="size-4" />
              </>
            ) : status === 'draft' ? (
              <>
                Publish <Check className="size-4" />
              </>
            ) : (
              <>
                Publish changes <Check className="size-4" />
              </>
            )}
          </Button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-3.5 px-4 pt-6 pb-8 sm:px-8">
          {publishErrors.length > 0 && (
            <div className="rounded-2xl border border-[#ffb59a] bg-brand-tint px-5 py-3.5 text-[13.5px] text-[#a12b0b]">
              <div className="flex items-center gap-2 font-semibold">
                <CircleAlert className="size-4" /> Couldn’t publish
              </div>
              <ul className="mt-1 list-disc pl-6">
                {publishErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          <TriggerSection recipe={recipe} update={update} platform={platform} accountId={automation.accountId} issues={sectionIssues} />
          <PublicReplySection recipe={recipe} update={update} issues={sectionIssues} />
          <DmSection index={hasPublicReply ? 3 : 2} recipe={recipe} update={update} issues={sectionIssues} />
          <BoostersSection index={hasPublicReply ? 4 : 3} recipe={recipe} update={update} platform={platform} issues={sectionIssues} />

          <div className="sticky bottom-4 mt-1 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-[18px] bg-ink px-6 py-4 text-white">
            {status === 'draft' || unpublished ? (
              <>
                <span className={cx('eyebrow', issues.length ? 'text-[#ffb59a]' : 'text-lime')}>
                  {issues.length ? 'Needs attention' : 'Ready to publish'}
                </span>
                <Metric value={stepCount} label={stepCount === 1 ? 'step' : 'steps'} />
                {!isIceBreaker && <Metric value={branchCount} label={branchCount === 1 ? 'branch' : 'branches'} />}
                <Metric value={issues.length} label={issues.length === 1 ? 'issue' : 'issues'} />
              </>
            ) : (
              <>
                <span className="eyebrow text-lime">Last 30 days</span>
                <Metric value={formatNumber(stats.dmsSent)} label="DMs sent" />
                <Metric value={formatNumber(stats.runs)} label="runs" />
                <Metric value={stats.runs ? formatPercent(stats.completed / stats.runs) : '—'} label="completed" />
                <Metric value={formatNumber(stats.leads)} label="leads" />
              </>
            )}
          </div>
        </div>

        <aside className="border-t border-line bg-sand xl:border-t-0 xl:border-l">
          <div className="px-4 py-6 sm:px-8 xl:sticky xl:top-[81px]">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Live preview</h2>
              {hasPublicReply && (
                <Segmented
                  value={preview}
                  onChange={setPreview}
                  options={[
                    { value: 'comment', label: 'Comment' },
                    { value: 'dm', label: 'DM' },
                  ]}
                />
              )}
            </div>
            <div className="mt-6">
              <PhonePreview recipe={recipe} mode={hasPublicReply ? preview : 'dm'} username={username} />
            </div>
            <p className="mx-auto mt-5 max-w-[290px] text-center text-[12.5px] leading-relaxed text-subtle">
              This is what @sam.eats sees. Variables like {'{{first_name}}'} fill in automatically.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Metric({ value, label }: { value: number | string; label: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-display text-[20px] font-bold tracking-[-0.03em]">{value}</span>
      <span className="text-[13px] text-white/60">{label}</span>
    </span>
  )
}

function SaveIndicator({ state, conflict, onRetry }: { state: SaveState; conflict: boolean; onRetry: () => void }) {
  const [, rerender] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => rerender((n) => n + 1), 30_000)
    return () => clearInterval(timer)
  }, [])

  if (conflict) {
    return (
      <span className="flex items-center gap-2 text-[13px] text-brand">
        Not saved. Changed in another tab.
        <button type="button" onClick={() => location.reload()} className="font-semibold underline">
          Reload
        </button>
      </span>
    )
  }
  if (state.kind === 'saving') return <span className="text-[13px] text-subtle">Saving…</span>
  if (state.kind === 'error') {
    return (
      <span className="flex items-center gap-2 text-[13px] text-brand">
        Not saved. {state.message}
        <button type="button" onClick={onRetry} className="font-semibold underline">
          Retry
        </button>
      </span>
    )
  }
  return <span className="text-[13px] text-subtle">Saved {timeAgo(state.at)}</span>
}
