'use client'

import { Search, X } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { cx } from '@/components/ui'
import type { ContactFilters } from '@/lib/data/types'

export function ContactFiltersBar({ tags, filters }: { tags: string[]; filters: ContactFilters }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [query, setQuery] = useState(filters.q ?? '')

  const set = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('contact')
    router.replace(`${pathname}?${next}`, { scroll: false })
  }

  useEffect(() => {
    if (query === (filters.q ?? '')) return
    const timer = setTimeout(() => set('q', query.trim() || undefined), 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const active = Boolean(filters.q || filters.tag || filters.has)

  return (
    <div className="flex flex-wrap items-center gap-2.5 p-4">
      <label className="flex h-10 w-[280px] items-center gap-2 rounded-xl border border-line px-3 text-subtle focus-within:border-faint">
        <Search className="size-4" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, username, email"
          className="w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-subtle"
        />
      </label>
      {(['email', 'phone'] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          onClick={() => set('has', filters.has === kind ? undefined : kind)}
          className={cx(
            'h-10 rounded-xl border px-3.5 text-[13.5px] font-medium transition-colors',
            filters.has === kind ? 'border-ink bg-ink text-white' : 'border-line text-muted hover:text-ink',
          )}
        >
          Has {kind}
        </button>
      ))}
      <select
        value={filters.tag ?? ''}
        onChange={(e) => set('tag', e.target.value || undefined)}
        className="h-10 rounded-xl border border-line bg-white px-3 text-[13.5px] text-muted outline-none"
      >
        <option value="">Any tag</option>
        {tags.map((tag) => (
          <option key={tag} value={tag}>
            {tag}
          </option>
        ))}
      </select>
      {active && (
        <button
          type="button"
          onClick={() => {
            setQuery('')
            router.replace(pathname, { scroll: false })
          }}
          className="inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink"
        >
          <X className="size-3.5" /> Clear
        </button>
      )}
    </div>
  )
}
