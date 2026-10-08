'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { cx } from '@/components/ui'

export function Pager({ page, pages, total, size, sizes }: { page: number; pages: number; total: number; size: number; sizes: readonly number[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const go = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    next.delete('contact')
    router.replace(`${pathname}?${next}`, { scroll: false })
  }

  const button = 'h-9 rounded-xl border border-line px-3.5 text-[13.5px] font-medium transition-colors hover:text-ink disabled:pointer-events-none disabled:opacity-40'
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-[13px] text-muted">
      <label className="flex items-center gap-2">
        Rows per page
        <select
          value={size}
          onChange={(e) => go({ size: e.target.value, page: undefined })}
          className="h-9 rounded-xl border border-line bg-white px-2.5 text-[13.5px] outline-none"
        >
          {sizes.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <span>
        <strong className="font-semibold text-ink">
          {page} / {pages}
        </strong>{' '}
        (Total: {total})
      </span>
      <span className="flex gap-2">
        <button type="button" className={cx(button)} disabled={page <= 1} onClick={() => go({ page: page - 1 > 1 ? String(page - 1) : undefined })}>
          Previous
        </button>
        <button type="button" className={cx(button)} disabled={page >= pages} onClick={() => go({ page: String(page + 1) })}>
          Next
        </button>
      </span>
    </div>
  )
}
