'use client'

import { Braces } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { Keyword, cx } from '@/components/ui'

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
  'w-full rounded-xl border border-line bg-white px-3.5 text-[14px] text-ink outline-none transition-colors placeholder:text-faint focus:border-ink'

export function TextInput({
  value,
  onChange,
  maxLength,
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'onChange' | 'value'> & { value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cx(inputClass, 'h-10', maxLength !== undefined && 'pr-14', className)}
        {...props}
      />
      {maxLength && (
        <span
          className={cx(
            'pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-[11px]',
            value.length > maxLength ? 'text-brand' : 'text-faint',
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
}: {
  value: string
  onChange: (value: string) => void
  maxLength: number
  rows?: number
  placeholder?: string
  footer?: ReactNode
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [menu, setMenu] = useState(false)

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
    <div className="rounded-xl border border-line bg-white transition-colors focus-within:border-ink">
      <textarea
        ref={ref}
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full resize-none rounded-t-xl bg-transparent px-3.5 pt-3 pb-1 text-[14.5px] leading-relaxed outline-none placeholder:text-faint"
      />
      <div className="flex items-center gap-3 border-t border-line/70 px-3.5 py-2">
        <div className="min-w-0 flex-1">{footer}</div>
        <span className={cx('font-mono text-[11px]', value.length > maxLength ? 'text-brand' : 'text-faint')}>
          {value.length}/{maxLength}
        </span>
        <div className="relative">
          <button
            type="button"
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
}: {
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')

  const commit = () => {
    const words = draft
      .split(',')
      .map((w) => w.trim())
      .filter((w) => w && !value.some((existing) => existing.toLowerCase() === w.toLowerCase()))
    if (words.length > 0) onChange([...value, ...words].slice(0, 20))
    setDraft('')
  }

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-line bg-white px-2.5 py-2 transition-colors focus-within:border-ink">
      {value.map((word) => (
        <Keyword key={word} onRemove={() => onChange(value.filter((w) => w !== word))}>
          {word}
        </Keyword>
      ))}
      <input
        value={draft}
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
    <div className="inline-flex rounded-full bg-sand p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={cx(
            'h-8 rounded-full px-3.5 text-[13px] font-semibold transition-colors disabled:opacity-40',
            value === option.value ? 'bg-white text-ink shadow-[0_1px_2px_rgba(21,19,16,0.08)]' : 'text-muted hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
