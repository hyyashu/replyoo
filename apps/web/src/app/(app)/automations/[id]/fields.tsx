'use client'

import { Braces } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Keyword, cx } from '@/components/ui'
import { KEYWORD_LIMITS, addChips } from '@/lib/recipe'

const VARIABLES = [
  { token: '{{first_name|there}}', label: 'First name' },
  { token: '{{username}}', label: 'Username' },
  { token: '{{email}}', label: 'Email' },
  { token: '{{phone}}', label: 'Phone' },
]

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <span className="text-[13px] font-medium text-ink-2">{children}</span>
      {hint && <span className="text-[12px] text-subtle">{hint}</span>}
    </div>
  )
}

export const inputClass =
  'w-full rounded-xl border border-line bg-white px-3.5 text-[14px] text-ink outline-none transition-colors placeholder:text-faint focus:border-ink focus-visible:ring-2 focus-visible:ring-ink/25'

export function TextInput({
  value,
  onChange,
  maxLength,
  className,
  label,
  ...props
}: Omit<React.ComponentProps<'input'>, 'onChange' | 'value'> & {
  value: string
  onChange: (value: string) => void
  /** Accessible name; pass the visible label text. */
  label?: string
}) {
  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={cx(inputClass, 'h-10', maxLength !== undefined && 'pr-14', className)}
        {...props}
      />
      {maxLength && (
        <span
          className={cx(
            'pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-[11px]',
            value.length > maxLength ? 'text-brand' : 'text-subtle',
          )}
        >
          {value.length}/{maxLength}
        </span>
      )}
    </div>
  )
}

/** Message textarea with a variable inserter and a live character count. */
export function MessageInput({
  value,
  onChange,
  maxLength,
  rows = 3,
  placeholder,
  footer,
  label,
}: {
  value: string
  onChange: (value: string) => void
  maxLength: number
  rows?: number
  placeholder?: string
  footer?: ReactNode
  /** Accessible name; pass the visible label text. */
  label?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    if (!menu) return
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(false)
    }
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setMenu(false)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const insert = (token: string) => {
    const el = ref.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    onChange(value.slice(0, start) + token + value.slice(end))
    setMenu(false)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  return (
    <div className="rounded-xl border border-line bg-white transition-colors focus-within:border-ink focus-within:ring-2 focus-within:ring-ink/25">
      <textarea
        ref={ref}
        value={value}
        rows={rows}
        aria-label={label}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full resize-none rounded-t-xl bg-transparent px-3.5 pt-3 pb-1 text-[14.5px] leading-relaxed outline-none placeholder:text-faint"
      />
      <div className="flex items-center gap-3 border-t border-line/70 px-3.5 py-2">
        <div className="min-w-0 flex-1">{footer}</div>
        <span className={cx('font-mono text-[11px]', value.length > maxLength ? 'text-brand' : 'text-subtle')}>
          {value.length}/{maxLength}
        </span>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
            className="inline-flex items-center gap-1 font-mono text-[11px] text-subtle hover:text-ink"
          >
            <Braces className="size-3.5" /> Variables
          </button>
          {menu && (
            <div className="absolute right-0 bottom-full z-20 mb-1 w-44 rounded-xl border border-line bg-white p-1 shadow-[0_12px_32px_rgba(21,19,16,0.12)]">
              {VARIABLES.map((v) => (
                <button
                  key={v.token}
                  type="button"
                  onClick={() => insert(v.token)}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-sand"
                >
                  {v.label}
                  <span className="font-mono text-[10.5px] text-subtle">{v.token.replace('|there', '')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function KeywordInput({
  value,
  onChange,
  placeholder = 'Add keyword…',
  max = KEYWORD_LIMITS.max,
  maxLength = KEYWORD_LIMITS.maxLength,
  label,
}: {
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  /** How many chips fit, and how long each may be. */
  max?: number
  maxLength?: number
  /** Accessible name; pass the visible label text. */
  label?: string
}) {
  const [draft, setDraft] = useState('')
  const [dropped, setDropped] = useState(0)

  const commit = () => {
    if (draft.trim() === '') return setDraft('')
    const added = addChips(value, draft, { max, maxLength })
    if (added.value.length > value.length) onChange(added.value)
    setDropped(added.dropped)
    setDraft('')
  }

  return (
    <>
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-line bg-white px-2.5 py-2 transition-colors focus-within:border-ink focus-within:ring-2 focus-within:ring-ink/25">
        {value.map((word, index) => (
          <Keyword
            key={`${index}:${word}`}
            onRemove={() => {
              setDropped(0)
              onChange(value.filter((_, i) => i !== index))
            }}
          >
            {word}
          </Keyword>
        ))}
        <input
          value={draft}
          aria-label={label}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
              onChange(value.slice(0, -1))
            }
          }}
          onBlur={commit}
          placeholder={value.length === 0 ? placeholder : 'Add…'}
          className="min-w-[120px] flex-1 bg-transparent px-1 text-[14px] outline-none placeholder:text-faint"
        />
      </div>
      {dropped > 0 && (
        <p className="mt-1.5 text-[12.5px] text-brand">
          {dropped} not added (max {max})
        </p>
      )}
    </>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: ReactNode; disabled?: boolean }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-full bg-sand p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={option.disabled}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cx(
            'h-8 shrink-0 rounded-full px-3.5 text-[13px] font-semibold whitespace-nowrap transition-colors disabled:opacity-40',
            value === option.value ? 'bg-white text-ink shadow-[0_1px_2px_rgba(21,19,16,0.08)]' : 'text-muted hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
