import { MessageCircleReply } from 'lucide-react'
import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'
import type { AutomationStatus } from '@/lib/data/types'

export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ')

const BUTTON = {
  primary: 'bg-brand text-white hover:bg-[#f0461a] shadow-[0_1px_0_rgba(0,0,0,0.05)]',
  secondary: 'border border-line bg-white text-ink hover:bg-sand',
  dark: 'bg-ink text-white hover:bg-ink-2',
  lime: 'bg-lime text-ink hover:bg-[#cfe94c]',
  ghost: 'text-muted hover:bg-sand hover:text-ink',
} as const

type ButtonVariant = keyof typeof BUTTON

export function buttonClass(variant: ButtonVariant = 'primary', size: 'sm' | 'md' = 'md') {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50',
    size === 'md' ? 'h-10 px-4.5 text-[14px]' : 'h-8 px-3 text-[13px]',
    BUTTON[variant],
  )
}

export function Button({
  variant,
  size,
  className,
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant; size?: 'sm' | 'md' }) {
  return <button type="button" className={cx(buttonClass(variant, size), className)} {...props} />
}

export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: 'sm' | 'md' }) {
  return <Link className={cx(buttonClass(variant, size), className)} {...props} />
}

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className={cx('grid size-[30px] place-items-center rounded-[9px]', dark ? 'bg-lime text-ink' : 'bg-ink text-lime')}>
        <MessageCircleReply className="size-4" strokeWidth={2.25} />
      </span>
      <span className={cx('font-display text-[21px] font-bold tracking-[-0.04em]', dark ? 'text-white' : 'text-ink')}>
        replyooo
      </span>
    </span>
  )
}

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('rounded-[20px] border border-line bg-white', className)} {...props} />
}

const STATUS = {
  active: { label: 'Live', className: 'bg-lime-soft text-lime-ink', dot: 'bg-green' },
  paused: { label: 'Paused', className: 'bg-amber-soft text-[#8a4b0f]', dot: 'bg-amber' },
  draft: { label: 'Draft', className: 'bg-cream text-muted', dot: 'bg-subtle' },
} as const

export function StatusPill({ status }: { status: AutomationStatus }) {
  const s = STATUS[status]
  return (
    <span className={cx('inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold', s.className)}>
      <span className={cx('size-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  )
}

export function Keyword({ children, onRemove }: { children: ReactNode; onRemove?: () => void }) {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-md border border-line bg-cream px-2 font-mono text-[11px] font-semibold text-ink">
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} className="-mr-0.5 text-subtle hover:text-ink" aria-label="Remove">
          ×
        </button>
      )}
    </span>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-40',
        checked ? 'bg-brand' : 'bg-line',
      )}
    >
      <span
        className={cx(
          'absolute size-[18px] rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-[19px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  )
}

const AVATAR_COLORS = ['#FFB59A', '#D8F25A', '#CDE9FF', '#DED8FF', '#FFD7C4', '#E6F6B5']

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const hash = [...name].reduce((total, char) => total + char.charCodeAt(0), 0)
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full text-[12px] font-semibold text-ink/70"
      style={{ width: size, height: size, background: AVATAR_COLORS[hash % AVATAR_COLORS.length] }}
      aria-hidden
    >
      {name.replace(/[^a-zA-Z]/g, '').slice(0, 1).toUpperCase()}
    </span>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-display text-[34px] leading-tight font-bold tracking-[-0.04em]">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2.5">{actions}</div>}
    </div>
  )
}

export function StatCard({ label, value, icon, hint }: { label: string; value: string; icon: ReactNode; hint?: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between text-[14px] text-muted">
        {label}
        <span className="text-subtle">{icon}</span>
      </div>
      <div className="mt-3 font-display text-[32px] leading-none font-bold tracking-[-0.04em]">{value}</div>
      {hint && <div className="mt-3 text-[12.5px] text-subtle">{hint}</div>}
    </Card>
  )
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-sand text-muted">{icon}</div>
      <h3 className="mt-4 text-[16px] font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-[14px] text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export const formatNumber = (n: number) => new Intl.NumberFormat('en-US').format(n)
export const formatCompact = (n: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
export const formatPercent = (n: number) => `${Math.round(n * 100)}%`

export function timeAgo(iso: string) {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  const units: [number, string][] = [
    [86_400, 'd'],
    [3_600, 'h'],
    [60, 'min'],
  ]
  for (const [size, unit] of units) if (seconds >= size) return `${Math.floor(seconds / size)}${unit === 'min' ? ' min' : unit} ago`
  return 'just now'
}
