'use client'

import { stepTargets, type Platform } from '@replyooo/shared'
import { ArrowLeft, Check, CircleAlert, LoaderCircle, Pause, Pencil, Play } from 'lucide-react'
import Link from 'next/link'
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
  const [dirty, setDirty] = useState(false)
  const [save, setSave] = useState<SaveState>({ kind: 'saved', at: automation.updatedAt })
  const [publishErrors, setPublishErrors] = useState<string[]>([])
  const [published, setPublished] = useState(false)
  const [preview, setPreview] = useState<'comment' | 'dm'>('dm')
  const [publishing, startPublish] = useTransition()
  const [, startStatus] = useTransition()

  const { flow, issues } = useMemo(() => checkRecipe(recipe, platform), [recipe, platform])
  const sectionIssues = (section: RecipeSection) => issues.filter((issue) => issue.section === section)

  const update: Update = (fn) => {
    setRecipe((current) => {
      const next = structuredClone(current)
      fn(next)
      return next
    })
    setDirty(true)
    setPublished(false)
    setPublishErrors([])
  }

  // Debounced autosave of the draft whenever it differs from what was last saved.
  const snapshot = JSON.stringify({ name, flow })
  const lastSaved = useRef(snapshot)
  useEffect(() => {
    if (snapshot === lastSaved.current) return
    setSave({ kind: 'saving' })
    const timer = setTimeout(async () => {
      const { name: savedName, flow: savedFlow } = JSON.parse(snapshot) as { name: string; flow: unknown }
      const result = await saveDraft(automation.id, savedName, savedFlow)
      if (result.ok) lastSaved.current = snapshot
      setSave(result.ok ? { kind: 'saved', at: result.savedAt } : { kind: 'error', message: result.error })
    }, 700)
    return () => clearTimeout(timer)
  }, [automation.id, snapshot])

  const publish = () =>
    startPublish(async () => {
      const result = await publishAutomation(automation.id, name, flow)
      if (result.ok) {
        setStatus('active')
        setDirty(false)
        setPublished(true)
        setSave({ kind: 'saved', at: new Date().toISOString() })
      } else {
        setPublishErrors(result.errors)
      }
    })

  const toggleLive = () => {
    const previous = status
    const next = status === 'active' ? 'paused' : 'active'
    setStatus(next)
    startStatus(async () => {
      const result = await setAutomationStatus(automation.id, next)
      if (!result.ok) {
        setStatus(previous)
        setPublishErrors([result.error])
      }
    })
  }

  const isIceBreaker = recipe.trigger.type === 'ice_breaker'
  const hasPublicReply = recipe.trigger.type === 'comment_keyword'
  const stepCount = Object.keys(flow.steps).length
  const branchCount = Object.values(flow.steps).filter((step) => new Set(stepTargets(step)).size > 1).length
  const canPublish = issues.length === 0 && !publishing && (dirty || status === 'draft')
  const { stats } = automation

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex items-center gap-4 border-b border-line bg-white/95 px-8 py-4 backdrop-blur">
        <Link
          href="/automations"
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
                onChange={(e) => {
                  setName(e.target.value)
                  setDirty(true)
                }}
                className="field-sizing-content min-w-[8ch] max-w-[420px] rounded-md bg-transparent font-display text-[20px] font-bold tracking-[-0.03em] outline-none focus:bg-sand"
              />
              <Pencil className="size-3.5 text-faint group-hover:text-muted" />
            </label>
            <StatusPill status={status} />
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <SaveIndicator state={save} />
          {status !== 'draft' && (
            <Button variant="secondary" onClick={toggleLive}>
              {status === 'active' ? <Pause className="size-4" /> : <Play className="size-4" />}
              {status === 'active' ? 'Pause' : 'Resume'}
            </Button>
          )}
          <Button onClick={publish} disabled={!canPublish} title={issues.length ? 'Fix the issues below first' : undefined}>
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

      <div className="grid flex-1 grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col gap-3.5 px-8 pt-6 pb-8">
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

          <TriggerSection recipe={recipe} update={update} platform={platform} issues={sectionIssues} />
          <PublicReplySection recipe={recipe} update={update} issues={sectionIssues} />
          <DmSection index={hasPublicReply ? 3 : 2} recipe={recipe} update={update} issues={sectionIssues} />
          <BoostersSection index={hasPublicReply ? 4 : 3} recipe={recipe} update={update} platform={platform} issues={sectionIssues} />

          <div className="sticky bottom-4 mt-1 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-[18px] bg-ink px-6 py-4 text-white">
            {status === 'draft' || dirty ? (
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

        <aside className="border-l border-line bg-sand">
          <div className="sticky top-[81px] px-8 py-6">
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

function SaveIndicator({ state }: { state: SaveState }) {
  const [, rerender] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => rerender((n) => n + 1), 30_000)
    return () => clearInterval(timer)
  }, [])

  if (state.kind === 'saving') return <span className="text-[13px] text-subtle">Saving…</span>
  if (state.kind === 'error') return <span className="text-[13px] text-brand">Not saved — {state.message.toLowerCase()}</span>
  return <span className="text-[13px] text-subtle">Saved {timeAgo(state.at)}</span>
}
