'use client'

import { stepTargets, type Platform } from '@replyooo/shared'
import { ArrowLeft, Check, CircleAlert, Eye, LoaderCircle, Pause, Pencil, Play, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { listPosts, listStories, publishAutomation, saveDraft, setAutomationStatus } from '@/app/actions'
import { Button, StatusPill, cx, formatNumber, formatPercent, timeAgo } from '@/components/ui'
import type { RecentPost } from '@/lib/data'
import type { Automation } from '@/lib/data/types'
import { recipeFromFlow, type Recipe } from '@/lib/recipe'
import { checkRecipe, type RecipeSection } from '@/lib/validation'
import { Segmented } from './fields'
import { PhonePreview, previewModes, type PreviewMode } from '@/components/phone-preview'
import { Accordion, BoostersSection, DmSection, ProgressCue, PublicReplySection, TriggerSection, type Update } from './sections'

type SaveState = { kind: 'saved'; at: string } | { kind: 'saving' } | { kind: 'error'; message: string }
type SaveResult = { ok: true; savedAt: string } | { ok: false; error: string; conflict?: boolean }

const savedNow = (): SaveState => ({ kind: 'saved', at: new Date().toISOString() })
const NETWORK_ERROR = "Couldn't reach Replyooo. Check your connection and try again."
// Sent drafts whose response never arrived. The server may have stored any of them, so it accepts each as the base.
const MAX_UNCONFIRMED = 10

/**
 * The save started when an editor unmounts (see below), per automation, until it settles. An editor that mounts
 * while one is running (leave, then Back) still gets the older draft from the server, so it seeds its accepted
 * bases with the flushed draft and adopts it once the save is confirmed.
 */
type PendingFlush = { name: string; flow: unknown; snap: string; promise: Promise<SaveResult> }
const pendingFlushes = new Map<string, PendingFlush>()

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
  const [preview, setPreview] = useState<PreviewMode>('dm')
  const [previewOpen, setPreviewOpen] = useState(false)
  // Posts and stories the picker (or the first load below) has seen, so the preview can show the chosen one.
  const [media, setMedia] = useState<Record<string, RecentPost>>({})
  const rememberMedia = useCallback(
    (posts: RecentPost[]) => setMedia((current) => ({ ...current, ...Object.fromEntries(posts.map((post) => [post.id, post])) })),
    [],
  )
  useEffect(() => {
    const t = recipe.trigger
    const wantsStory = t.type === 'story_reply' && t.stories.mode === 'specific' && t.stories.mediaIds.length > 0
    const wantsPost = t.type === 'comment_keyword' && t.posts.mode === 'specific' && t.posts.mediaIds.length > 0
    if (!wantsStory && !wantsPost) return
    let cancelled = false
    ;(wantsStory ? listStories : listPosts)(automation.accountId)
      .then((result) => !cancelled && result.ok && rememberMedia(result.posts))
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // Once on open: the picker reports anything chosen afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!previewOpen) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setPreviewOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [previewOpen])
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
  // Drafts this editor sent without hearing back; they may or may not be stored. Anything here also blocks "settled".
  const unconfirmed = useRef<unknown[]>([])
  // A leave-page save from an earlier mount of this page that was still running when this one mounted.
  const [pendingFlush] = useState(() => pendingFlushes.get(automation.id))
  const flushed = useRef<unknown[]>(pendingFlush ? [pendingFlush.flow] : [])
  const acceptedBases = () => [...flushed.current, ...unconfirmed.current]
  const confirmed = (flow: unknown) => {
    baseFlow.current = flow
    flushed.current = []
    unconfirmed.current = []
  }
  const rememberUnconfirmed = (flow: unknown) => {
    const key = JSON.stringify(flow)
    // The base is accepted anyway.
    if (key === JSON.stringify(baseFlow.current)) return
    unconfirmed.current = [...unconfirmed.current.filter((item) => JSON.stringify(item) !== key), flow].slice(-MAX_UNCONFIRMED)
  }
  // Nothing to send and no doubt about what the server holds.
  const isSettled = () => latest.current === lastSaved.current && unconfirmed.current.length === 0
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
      // Not when an earlier send may have stored a different draft: that one still has to be overwritten.
      if (lastSaved.current === snap && unconfirmed.current.length === 0) return { ok: true, savedAt: new Date().toISOString() }
      inFlight.current++
      try {
        const result = await saveDraft(automation.id, savedName, savedFlow, baseFlow.current, acceptedBases())
        if (result.ok) {
          confirmed(savedFlow)
          lastSaved.current = snap
        }
        return result
      } catch {
        // The request may have reached the server before the connection dropped.
        rememberUnconfirmed(savedFlow)
        return { ok: false, error: NETWORK_ERROR }
      } finally {
        inFlight.current--
      }
    })
  }

  // Debounced autosave of the draft whenever it differs from what was last saved.
  useEffect(() => {
    if (conflict) return
    if (isSettled()) {
      // Edited back to what's saved: nothing to send, so a "Saving…" or "Not saved" left by the edit it undoes is stale.
      // A request still in flight settles the status when it returns. (A conflict returned above and stays.)
      if (inFlight.current === 0) setSave((current) => (current.kind === 'saved' ? current : savedNow()))
      return
    }
    setSave({ kind: 'saving' })
    const timer = setTimeout(async () => {
      if (isSettled()) return setSave(savedNow())
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
      if (isSettled()) return
      const snap = latest.current
      const { name: flushedName, flow: flushedFlow } = JSON.parse(snap) as { name: string; flow: unknown }
      const entry: PendingFlush = { name: flushedName, flow: flushedFlow, snap, promise: saveSnapshot(snap) }
      pendingFlushes.set(automation.id, entry)
      const done = () => {
        if (pendingFlushes.get(automation.id) === entry) pendingFlushes.delete(automation.id)
      }
      void entry.promise.then(done, done)
    },
    // saveSnapshot only reads refs and the (constant) automation id.
    [],
  )

  // Back on the page while the leave-page save of an earlier visit is still running: the server rendered the draft from
  // before it. Its flow is already an accepted base (seeded above), so edits made now save fine; once the save is
  // confirmed, show what it stored, unless there are edits here already.
  useEffect(() => {
    if (!pendingFlush) return
    let active = true
    const initial = lastSaved.current
    void pendingFlush.promise.then((result) => {
      if (!active || !result.ok) return
      // Anything saved or typed since mount is newer than the flushed draft.
      if (inFlight.current > 0 || latest.current !== initial || lastSaved.current !== initial) return
      confirmed(pendingFlush.flow)
      lastSaved.current = pendingFlush.snap
      setName(pendingFlush.name)
      setRecipe(recipeFromFlow(pendingFlush.flow as Automation['flow']))
    })
    return () => {
      active = false
    }
    // Reads refs only; pendingFlush never changes.
  }, [pendingFlush])

  // Come back online: retry a save that failed because we were offline.
  const failed = save.kind === 'error' && !conflict
  useEffect(() => {
    if (!failed) return
    const retry = () => setSaveAttempt((n) => n + 1)
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [failed])

  const hasUnsavedWork = () => inFlight.current > 0 || !isSettled()
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
        const result = await enqueue(() => publishAutomation(automation.id, name, flow, baseFlow.current, acceptedBases()))
        if (result.ok) {
          confirmed(flow)
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
            confirmed(flow)
            lastSaved.current = snap
            if (latest.current === snap) setSave(savedNow())
          }
          if ('conflict' in result && result.conflict) setConflict(true)
          setPublishErrors(result.errors)
        }
      } catch {
        // The draft may have been stored before the connection dropped.
        rememberUnconfirmed(flow)
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

  const progressSteps: { id: RecipeSection; label: string; ready: boolean }[] = [
    { id: 'trigger', label: 'Trigger', ready: sectionIssues('trigger').length === 0 },
    ...(recipe.trigger.type === 'comment_keyword'
      ? [{ id: 'publicReply' as const, label: 'Public reply', ready: sectionIssues('publicReply').length === 0 }]
      : []),
    ...(recipe.trigger.type === 'ice_breaker' ? [] : [{ id: 'dm' as const, label: 'DM', ready: sectionIssues('dm').length === 0 }]),
  ]
  const isIceBreaker = recipe.trigger.type === 'ice_breaker'
  const hasPublicReply = recipe.trigger.type === 'comment_keyword'
  const chosenId =
    recipe.trigger.type === 'comment_keyword' && recipe.trigger.posts.mode === 'specific'
      ? recipe.trigger.posts.mediaIds[0]
      : recipe.trigger.type === 'story_reply' && recipe.trigger.stories?.mode === 'specific'
        ? recipe.trigger.stories.mediaIds[0]
        : undefined
  const previewMedia = chosenId ? media[chosenId] : undefined
  const previewTabs = previewModes(recipe.trigger)
  const previewMode = previewTabs.some((tab) => tab.value === preview) ? preview : 'dm'
  const stepCount = Object.keys(flow.steps).length
  const branchCount = Object.values(flow.steps).filter((step) => new Set(stepTargets(step)).size > 1).length
  const canPublish = issues.length === 0 && !publishing && !conflict && (unpublished || status === 'draft')
  const { stats } = automation

  const previewPanel = (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Live preview</h2>
        {previewTabs.length > 1 && <Segmented value={previewMode} onChange={setPreview} options={previewTabs} />}
      </div>
      <div className="mt-6">
        <PhonePreview recipe={recipe} mode={previewMode} username={username} media={previewMedia} />
      </div>
      <p className="mx-auto mt-5 max-w-[290px] text-center text-[12.5px] leading-relaxed text-subtle">
        This is what @sam.eats sees. Variables like {'{{first_name}}'} fill in automatically.
      </p>
    </>
  )

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex items-center gap-2.5 border-b border-line bg-white/95 px-3 py-3 backdrop-blur sm:gap-4 sm:px-8 sm:py-4">
        <Link
          href="/automations"
          onClick={goBack}
          aria-label="Back to automations"
          className="grid size-9 shrink-0 place-items-center rounded-xl border border-line hover:bg-sand sm:size-10"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex-1 sm:flex-none">
          <div className="hidden text-[12.5px] text-subtle sm:block">Automations</div>
          {/* On phones the row is one line tall and clipped: if the name can't get ~9 characters it wraps out of view. */}
          <div className="flex h-7 flex-wrap items-center gap-2.5 overflow-hidden sm:h-auto sm:overflow-visible">
            <label className="group flex min-w-0 flex-[1_1_9ch] items-center gap-1.5 sm:flex-none">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Automation name"
                className="field-sizing-content w-full min-w-0 max-w-full truncate sm:w-auto rounded-md bg-transparent font-display text-[17px] sm:min-w-[8ch] sm:max-w-[420px] sm:text-[20px] font-bold tracking-[-0.03em] outline-none focus:bg-sand"
              />
              <Pencil className="size-3.5 shrink-0 text-faint group-hover:text-muted" />
            </label>
            <span className="hidden sm:inline-flex">
              <StatusPill status={status} />
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 sm:hidden">
            <StatusPill status={status} />
            <SaveIndicator state={save} conflict={conflict} onRetry={() => setSaveAttempt((n) => n + 1)} />
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center justify-end gap-2 sm:gap-3">
          <span className="hidden sm:inline">
            <SaveIndicator state={save} conflict={conflict} onRetry={() => setSaveAttempt((n) => n + 1)} />
          </span>
          <Button
            variant="secondary"
            className="min-[1180px]:hidden"
            aria-haspopup="dialog"
            aria-label="Preview"
            onClick={() => setPreviewOpen(true)}
          >
            <Eye className="size-4" /> <span className="hidden sm:inline">Preview</span>
          </Button>
          {status !== 'draft' && (
            <Button
              variant="secondary"
              aria-label={status === 'active' ? 'Pause' : 'Resume'}
              onClick={toggleLive}
              disabled={publishing || statusPending}
            >
              {status === 'active' ? <Pause className="size-4" /> : <Play className="size-4" />}
              <span className="hidden sm:inline">{status === 'active' ? 'Pause' : 'Resume'}</span>
            </Button>
          )}
          <Button
            className="justify-center sm:min-w-[168px]"
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
                <span className="sm:hidden">Publish</span>
                <span className="hidden sm:inline">Publish changes</span> <Check className="size-4" />
              </>
            )}
          </Button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 min-[1180px]:grid-cols-[minmax(0,1fr)_360px]">
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

          <Accordion>
            <TriggerSection recipe={recipe} update={update} platform={platform} accountId={automation.accountId} onMedia={rememberMedia} issues={sectionIssues} />
            <PublicReplySection recipe={recipe} update={update} issues={sectionIssues} />
            <DmSection index={hasPublicReply ? 3 : 2} recipe={recipe} update={update} issues={sectionIssues} />
            <BoostersSection index={hasPublicReply ? 4 : 3} recipe={recipe} update={update} platform={platform} issues={sectionIssues} />

            <div className="sticky bottom-4 mt-1 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-[18px] bg-ink px-6 py-4 text-white">
              {status === 'draft' || unpublished ? (
                <>
                  <span className={cx('eyebrow', issues.length ? 'text-[#ffb59a]' : 'text-lime')}>
                    {issues.length ? 'Needs attention' : 'Ready to publish'}
                  </span>
                  <ProgressCue steps={progressSteps} />
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
          </Accordion>
        </div>

        <aside className="hidden border-line bg-sand min-[1180px]:block min-[1180px]:border-l">
          <div className="px-6 py-6 min-[1180px]:sticky min-[1180px]:top-[81px]">{previewPanel}</div>
        </aside>
      </div>

      {previewOpen && (
        <div className="fixed inset-0 z-40 flex justify-end min-[1180px]:hidden" role="dialog" aria-modal="true" aria-label="Live preview">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setPreviewOpen(false)} />
          <div className="relative h-full w-[440px] max-w-full overflow-y-auto bg-sand px-6 py-6">
            <button
              type="button"
              aria-label="Close preview"
              onClick={() => setPreviewOpen(false)}
              className="absolute top-4 right-4 grid size-8 place-items-center rounded-lg text-muted hover:bg-white"
            >
              <X className="size-4" />
            </button>
            {previewPanel}
          </div>
        </div>
      )}
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
