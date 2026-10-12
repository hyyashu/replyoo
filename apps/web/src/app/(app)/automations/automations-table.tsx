'use client'

import { useDashboardFormatters } from '@/i18n/use-format'

import { useTranslations } from 'next-intl'

import { Clapperboard, Ellipsis, MessageCircleQuestion, MessageSquare, MessagesSquare, Search, Zap } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { deleteAutomation, setAutomationStatus } from '@/app/actions'
import { ConfirmDialog } from '@/components/confirm-action'
import { ButtonLink, Card, EmptyState, Keyword, StatusPill, cx } from '@/components/ui'
import type { Automation, AutomationStatus, StatusResult } from '@/lib/data/types'
import { flowSearchText, triggerChips, triggerLabel } from '@/lib/describe'

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
  const tr = useTranslations('automations')
  
  
  
  const TABS: { key: 'all' | AutomationStatus; label: string }[] = [
    { key: 'all', label: tr('all') },
    { key: 'active', label: tr('live') },
    { key: 'paused', label: tr('paused') },
    { key: 'draft', label: tr('drafts') },
  ]
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('all')
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return automations
      .filter((a) => tab === 'all' || a.status === tab)
      .filter((a) => !q || flowSearchText(a.name, a.flow).includes(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [automations, tab, query])

  const count = (key: (typeof TABS)[number]['key']) => (key === 'all' ? automations.length : automations.filter((a) => a.status === key).length)

  return (
    <Card className="mt-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex w-full rounded-full bg-sand p-1 sm:w-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cx(
                'h-8 flex-1 rounded-full px-2 text-[13.5px] font-semibold whitespace-nowrap transition-colors sm:flex-none sm:px-3.5',
                tab === t.key ? 'bg-white text-ink shadow-[0_1px_2px_rgba(21,19,16,0.08)]' : 'text-ink-2 hover:text-ink',
              )}
            >
              {t.label} <span className="ml-1 font-normal text-subtle">{count(t.key)}</span>
            </button>
          ))}
        </div>
        <label className="flex h-10 w-full items-center gap-2 rounded-xl border border-line px-3 text-subtle focus-within:border-faint sm:w-[280px]">
          <Search className="size-4" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr('search_automations_or_keywords')}
            className="w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-subtle"
          />
        </label>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Zap className="size-5" />}
          title={automations.length === 0 ? tr('no_automations_yet') : tr('nothing_matches')}
          body={
            automations.length === 0 ? tr('start_from_a_template_most_people_are_live_in_under_3') : tr('try_a_different_keyword_or_status_filter')
          }
          action={automations.length === 0 && <ButtonLink href="/automations/new">{tr('browse_templates')}</ButtonLink>}
        />
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="eyebrow border-y border-line bg-sand/70 [&>th]:h-10 [&>th]:font-medium">
              <th className="pl-4 md:pl-5">{tr('automation')}</th>
              <th className="hidden md:table-cell">{tr('trigger')}</th>
              <th className="hidden text-right md:table-cell">{tr('runs_2')}</th>
              <th className="hidden text-right md:table-cell">{tr('dms_sent')}</th>
              <th className="hidden pr-2 text-right md:table-cell">{tr('completion')}</th>
              <th className="hidden lg:table-cell">{tr('created')}</th>
              <th className="hidden lg:table-cell">{tr('updated')}</th>
              <th className="pl-3 md:pl-6">{tr('status')}</th>
              <th className="w-12 md:w-14" />
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
  const { formatNumber, formatPercent, formatDate } = useDashboardFormatters()
  const tr = useTranslations('automations')
  
  const common = useTranslations('common')
  
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
      <td className="pl-4 md:pl-5">
        <Link href={href} className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <TriggerIcon type={flow.trigger.type} />
          <span className="min-w-0">
            <span className="block text-[14.5px] font-semibold">{automation.name}</span>
            <span className="block text-[12.5px] text-subtle">{triggerLabel(flow.trigger)}</span>
            {live && (
              <span className="block text-[12px] text-subtle tabular-nums md:hidden">
                {tr('runs_dms', { v0: formatNumber(stats.runs), v1: formatNumber(stats.dmsSent) })}
              </span>
            )}
          </span>
        </Link>
      </td>
      <td className="hidden md:table-cell">
        <div className="flex flex-wrap gap-1.5">
          {chips.slice(0, 3).map((chip) => (
            <Keyword key={chip}>{chip}</Keyword>
          ))}
          {chips.length > 3 && <span className="text-[12px] text-subtle">+{chips.length - 3}</span>}
        </div>
      </td>
      <td className="hidden text-right text-[14.5px] tabular-nums md:table-cell">{live ? formatNumber(stats.runs) : '—'}</td>
      <td className="hidden text-right text-[14.5px] tabular-nums md:table-cell">{live ? formatNumber(stats.dmsSent) : '—'}</td>
      <td className="hidden pr-2 text-right text-[14.5px] font-semibold tabular-nums md:table-cell">
        {live && stats.runs > 0 ? formatPercent(stats.completed / stats.runs) : '—'}
      </td>
      <td className="hidden text-[13px] whitespace-nowrap text-subtle lg:table-cell" suppressHydrationWarning>
        {formatDate(automation.createdAt)}
      </td>
      <td className="hidden text-[13px] whitespace-nowrap text-subtle lg:table-cell" suppressHydrationWarning>
        {formatDate(automation.updatedAt)}
      </td>
      <td className="pl-3 md:pl-6">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusPill label={common(`status_${automation.status}`)} status={automation.status} />
          {live && automation.hasUnpublishedChanges && <span className="text-[12px] font-medium text-[#8a4b0f]">{tr('unpublished_edits')}</span>}
        </div>
      </td>
      <td className="pr-2 md:pr-4" onClick={(e) => e.stopPropagation()}>
        <RowMenu automation={automation} />
      </td>
    </tr>
  )
}

function RowMenu({ automation }: { automation: Automation }) {
  const tr = useTranslations('automations')
  
  
  
  const [open, setOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [pending, startTransition] = useTransition()
  const [position, setPosition] = useState({ top: 0, right: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      const target = event.target as Node
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    const dismiss = () => setOpen(false)
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [open])

  // The menu is portaled to <body> so the table card's overflow-hidden can't clip it.
  const toggle = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) setPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    setOpen(!open)
  }

  const run = (action: () => Promise<StatusResult | void>) => {
    setOpen(false)
    startTransition(async () => {
      const result = await action()
      if (result && !result.ok) alert(result.error)
    })
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={tr('automation_actions')}
        onClick={toggle}
        className={cx('grid size-8 place-items-center rounded-lg text-subtle hover:bg-cream hover:text-ink', pending && 'opacity-50')}
      >
        <Ellipsis className="size-4" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{ top: position.top, right: position.right }}
            className="fixed z-50 w-44 rounded-xl border border-line bg-white p-1 text-[13.5px] shadow-[0_12px_32px_rgba(21,19,16,0.12)]"
          >
            <Link href={`/automations/${automation.id}`} className="block rounded-lg px-3 py-2 hover:bg-sand">
              {tr('edit')}
            </Link>
            {automation.status === 'active' && (
              <MenuButton onClick={() => run(() => setAutomationStatus(automation.id, 'paused'))}>{tr('pause')}</MenuButton>
            )}
            {automation.status === 'paused' && (
              <MenuButton onClick={() => run(() => setAutomationStatus(automation.id, 'active'))}>{tr('resume')}</MenuButton>
            )}
            <MenuButton
              danger
              onClick={() => {
                setOpen(false)
                setConfirmingDelete(true)
              }}
            >
              {tr('delete')}
            </MenuButton>
          </div>,
          document.body,
        )}
      <ConfirmDialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        action={async () => {
          await deleteAutomation(automation.id)
          setConfirmingDelete(false)
        }}
        title={tr('delete_2', { v0: automation.name })}
        description={tr('in_flight_conversations_will_stop_this_can_t_be_undone')}
        confirmLabel={tr('delete')}
      />
    </>
  )
}

function MenuButton({ danger, ...props }: React.ComponentProps<'button'> & { danger?: boolean }) {
  return <button type="button" className={cx('block w-full rounded-lg px-3 py-2 text-left hover:bg-sand', danger && 'text-[#c2330e]')} {...props} />
}
