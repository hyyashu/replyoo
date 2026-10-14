'use client'

import { Check, Copy } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Button, cx } from '@/components/ui'

export const toolField =
  'h-11 w-full rounded-xl border border-line bg-white px-3.5 text-[14px] outline-none transition-colors placeholder:text-faint focus:border-ink'

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-[12.5px] text-subtle">{hint}</p>}
    </div>
  )
}

/** The tool's result with a copy button. Shows `placeholder` until there is something to copy. `text` keeps line breaks, for messages rather than links. */
export function CopyResult({ label, value, placeholder, text = false }: { label: string; value: string | null; placeholder: string; text?: boolean }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (!value) return
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="rounded-2xl bg-sand p-4">
      <div className="eyebrow">{label}</div>
      <div className={cx('mt-2 flex gap-3', text ? 'items-start' : 'items-center')}>
        <output
          className={cx('min-w-0 flex-1 text-[15px]', text ? 'leading-relaxed break-words whitespace-pre-line' : 'font-medium break-all', !value && 'text-subtle')}
          aria-live="polite"
        >
          {value ?? placeholder}
        </output>
        <Button variant="dark" size="sm" onClick={copy} disabled={!value}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  )
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T | null
  onChange: (value: T) => void
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-full bg-sand p-1" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cx(
            'h-8 rounded-full px-3.5 text-[13px] font-semibold transition-colors',
            value === option.value ? 'bg-ink text-white' : 'text-muted hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
