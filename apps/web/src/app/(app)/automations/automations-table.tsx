'use client'

import { Clapperboard, Ellipsis, MessageCircleQuestion, MessageSquare, MessagesSquare, Search, Zap } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { deleteAutomation, setAutomationStatus } from '@/app/actions'
import { ButtonLink, Card, EmptyState, Keyword, StatusPill, cx, formatNumber, formatPercent } from '@/components/ui'
import type { Automation, AutomationStatus } from '@/lib/data/types'
import { flowSearchText, triggerChips, triggerLabel } from '@/lib/describe'

const TABS: { key: 'all' | AutomationStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Live' },
  { key: 'paused', label: 'Paused' },
  { key: 'draft', label: 'Drafts' },
]

export function TriggerIcon({ type }: { type: Automation['flow']['trigger']['type'] }) {
  const config = {
    comment_keyword: { icon: Clapperboard, className: 'bg-brand-soft text-brand' },
    story_reply: { icon: MessageCircleQuestion, className: 'bg-violet-soft text-violet' },
    dm_keyword: { icon: MessageSquare, className: 'bg-lime-soft text-lime-ink' },
    any_dm: { icon: MessagesSquare, className: 'bg-sky-soft text-[#1f5f99]' },
    ice_breaker: { icon: Zap, className: 'bg-amber-soft text-amber' },
  }[type]
  const Icon = config.icon
  return (
    <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', config.className)}>
      <Icon className="size-[18px]" strokeWidth={1.9} />
    </span>
  )
}

export function AutomationsTable({ automations }: { automations: Automation[] }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('all')
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return automations
      .filter((a) => tab === 'all' || a.status === tab)
      .filter((a) => !q || flowSearchText(a.name, a.flow).includes(q))
  }, [automations, tab, query])

  const count = (key: (typeof TABS)[number]['key']) =>
    key === 'all' ? automations.length : automations.filter((a) => a.status === key).length

  return (
    <Card className="mt-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex rounded-full bg-sand p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cx(
                'h-8 rounded-full px-3.5 text-[13.5px] font-semibold transition-colors',
                tab === t.key ? 'bg-white text-ink shadow-[0_1px_2px_rgba(21,19,16,0.08)]' : 'text-ink-2 hover:text-ink',
              )}
            >
              {t.label} <span className="ml-1 font-normal text-subtle">{count(t.key)}</span>
            </button>
          ))}
        </div>
        <label className="flex h-10 w-[280px] items-center gap-2 rounded-xl border border-line px-3 text-subtle focus-within:border-faint">
          <Search className="size-4" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search automations or keywords"
            className="w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-subtle"
          />
        </label>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Zap className="size-5" />}
          title={automations.length === 0 ? 'No automations yet' : 'Nothing matches'}
          body={
            automations.length === 0
              ? 'Start from a template — most people are live in under 3 minutes.'
              : 'Try a different keyword or status filter.'
          }
          action={automations.length === 0 && <ButtonLink href="/automations/new">Browse templates</ButtonLink>}
        />
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="eyebrow border-y border-line bg-sand/70 [&>th]:h-10 [&>th]:font-medium">
              <th className="pl-5">Automation</th>
              <th>Trigger</th>
              <th className="text-right">Runs</th>
              <th className="text-right">DMs sent</th>
              <th className="pr-2 text-right">Completion</th>
              <th className="pl-6">Status</th>
              <th className="w-14" />
            </tr>
          </thead>
          <tbody>
            {visible.map((automation) => (
              <Row key={automation.id} automation={automation} />
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

function Row({ automation }: { automation: Automation }) {
  const router = useRouter()
  const { stats, flow } = automation
  const live = automation.version > 0
  const chips = triggerChips(flow.trigger)
  const href = `/automations/${automation.id}`

  return (
    <tr
      onClick={() => router.push(href)}
      className="group h-[68px] cursor-pointer border-b border-line last:border-b-0 hover:bg-sand/40 [&>td]:align-middle"
    >
      <td className="pl-5">
        <Link href={href} className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <TriggerIcon type={flow.trigger.type} />
          <span>
            <span className="block text-[14.5px] font-semibold">{automation.name}</span>
            <span className="text-[12.5px] text-subtle">{triggerLabel(flow.trigger)}</span>
          </span>
        </Link>
      </td>
      <td>
        <div className="flex flex-wrap gap-1.5">
          {chips.slice(0, 3).map((chip) => (
            <Keyword key={chip}>{chip}</Keyword>
          ))}
          {chips.length > 3 && <span className="text-[12px] text-subtle">+{chips.length - 3}</span>}
        </div>
      </td>
      <td className="text-right text-[14.5px] tabular-nums">{live ? formatNumber(stats.runs) : '—'}</td>
      <td className="text-right text-[14.5px] tabular-nums">{live ? formatNumber(stats.dmsSent) : '—'}</td>
      <td className="pr-2 text-right text-[14.5px] font-semibold tabular-nums">
        {live && stats.runs > 0 ? formatPercent(stats.completed / stats.runs) : '—'}
      </td>
      <td className="pl-6">
        <StatusPill status={automation.status} />
      </td>
      <td className="pr-4" onClick={(e) => e.stopPropagation()}>
        <RowMenu automation={automation} />
      </td>
    </tr>
  )
}

function RowMenu({ automation }: { automation: Automation }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const run = (action: () => Promise<void>) => {
    setOpen(false)
    startTransition(action)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Automation actions"
        onClick={() => setOpen(!open)}
        className={cx('grid size-8 place-items-center rounded-lg text-subtle hover:bg-cream hover:text-ink', pending && 'opacity-50')}
      >
        <Ellipsis className="size-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-xl border border-line bg-white p-1 text-[13.5px] shadow-[0_12px_32px_rgba(21,19,16,0.12)]">
          <Link href={`/automations/${automation.id}`} className="block rounded-lg px-3 py-2 hover:bg-sand">
            Edit
          </Link>
          {automation.status === 'active' && (
            <MenuButton onClick={() => run(() => setAutomationStatus(automation.id, 'paused'))}>Pause</MenuButton>
          )}
          {automation.status === 'paused' && (
            <MenuButton onClick={() => run(() => setAutomationStatus(automation.id, 'active'))}>Resume</MenuButton>
          )}
          <MenuButton
            danger
            onClick={() => {
              if (confirm(`Delete “${automation.name}”? In-flight conversations will stop.`)) {
                run(() => deleteAutomation(automation.id))
              }
            }}
          >
            Delete
          </MenuButton>
        </div>
      )}
    </div>
  )
}

function MenuButton({ danger, ...props }: React.ComponentProps<'button'> & { danger?: boolean }) {
  return (
    <button
      type="button"
      className={cx('block w-full rounded-lg px-3 py-2 text-left hover:bg-sand', danger && 'text-[#c2330e]')}
      {...props}
    />
  )
}
