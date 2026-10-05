'use client'

import type { FlowTemplate, Platform, TemplateCategory } from '@replyooo/shared'
import { ArrowLeft, ArrowRight, Plus, Search } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { createAutomation } from '@/app/actions'
import { FacebookIcon, InstagramIcon } from '@/components/brand-icons'
import { Card, EmptyState, cx } from '@/components/ui'
import { triggerLabel } from '@/lib/describe'
import { TriggerIcon } from '../automations-table'

const CATEGORIES: { key: TemplateCategory | 'all'; label: string }[] = [
  { key: 'all', label: 'All templates' },
  { key: 'recommended', label: 'Recommended' },
  { key: 'sell_products', label: 'Sell products' },
  { key: 'collect_leads', label: 'Collect leads' },
  { key: 'grow_followers', label: 'Grow followers' },
  { key: 'engage_audience', label: 'Engage with audience' },
  { key: 'setup_inbox', label: 'Set up your inbox' },
]

export function TemplatePicker({
  templates,
  platform,
  username,
}: {
  templates: FlowTemplate[]
  platform: Platform
  username: string
}) {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]['key']>('all')
  const [query, setQuery] = useState('')
  const [pending, startTransition] = useTransition()
  const [chosen, setChosen] = useState<string | null>(null)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return templates
      .filter((t) => category === 'all' || t.categories.includes(category))
      .filter((t) => !q || `${t.title} ${t.description}`.toLowerCase().includes(q))
      .sort((a, b) => Number(b.platforms.includes(platform)) - Number(a.platforms.includes(platform)))
  }, [templates, category, query, platform])

  const create = (key: string | null) => {
    setChosen(key ?? 'scratch')
    startTransition(() => createAutomation(key))
  }

  return (
    <div className="mx-auto max-w-[1180px] px-10 py-9">
      <Link href="/automations" className="inline-flex items-center gap-1.5 text-[13.5px] text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Automations
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[34px] leading-tight font-bold tracking-[-0.04em]">Pick a starting point</h1>
          <p className="mt-1 text-[15px] text-muted">
            Templates for @{username}. You can change every message before going live.
          </p>
        </div>
        <label className="flex h-10 w-[300px] items-center gap-2 rounded-xl border border-line px-3 text-subtle focus-within:border-faint">
          <Search className="size-4" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search templates"
            className="w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-subtle"
          />
        </label>
      </div>

      <div className="mt-7 grid grid-cols-[200px_1fr] gap-8">
        <nav className="flex flex-col gap-0.5">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategory(c.key)}
              className={cx(
                'h-9 rounded-[10px] px-3 text-left text-[14px] transition-colors',
                category === c.key ? 'bg-sand font-semibold text-ink' : 'text-muted hover:text-ink',
              )}
            >
              {c.label}
            </button>
          ))}
        </nav>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <button
            type="button"
            disabled={pending}
            onClick={() => create(null)}
            className="flex min-h-[188px] flex-col items-center justify-center gap-3 rounded-[20px] border border-dashed border-faint p-5 text-center text-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-60"
          >
            <span className="grid size-10 place-items-center rounded-xl bg-sand">
              <Plus className="size-5" />
            </span>
            <span className="text-[14.5px] font-semibold">{chosen === 'scratch' ? 'Creating…' : 'Start from scratch'}</span>
          </button>

          {visible.map((template) => {
            const supported = template.platforms.includes(platform)
            return (
              <Card
                key={template.key}
                className={cx(
                  'group relative flex min-h-[188px] flex-col p-5 transition-shadow',
                  supported ? 'hover:shadow-[0_8px_24px_rgba(21,19,16,0.08)]' : 'opacity-55',
                )}
              >
                <div className="flex items-start justify-between">
                  <TriggerIcon type={template.flow.trigger.type} />
                  <div className="flex items-center gap-1.5 text-subtle">
                    {template.isNew && (
                      <span className="rounded-full bg-lime px-2 py-0.5 text-[11px] font-semibold text-ink">New</span>
                    )}
                    {template.platforms.includes('instagram') && <InstagramIcon className="size-3.5" />}
                    {template.platforms.includes('facebook') && <FacebookIcon className="size-3.5" />}
                  </div>
                </div>
                <h3 className="mt-4 text-[15.5px] leading-snug font-semibold">{template.title}</h3>
                <p className="mt-1 text-[13.5px] leading-snug text-muted">{template.description}</p>
                <div className="mt-auto flex items-center justify-between pt-4 text-[12.5px] text-subtle">
                  {supported ? triggerLabel(template.flow.trigger) : `Instagram only`}
                  {supported && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => create(template.key)}
                      className="inline-flex items-center gap-1 font-semibold text-brand after:absolute after:inset-0 disabled:opacity-60"
                    >
                      {chosen === template.key ? 'Creating…' : 'Use'} <ArrowRight className="size-3.5" />
                    </button>
                  )}
                </div>
              </Card>
            )
          })}

          {visible.length === 0 && (
            <div className="md:col-span-2">
              <EmptyState icon={<Search className="size-5" />} title="No templates found" body="Try another search, or start from scratch." />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
