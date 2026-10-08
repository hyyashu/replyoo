'use client'

import { Check, ChevronsUpDown, CircleHelp, House, LogOut, Menu, Plus, Settings, Users, X, Zap } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { signOut } from '@/app/auth-actions'
import { switchAccount } from '@/app/actions'
import type { ConnectedAccount, Subscription } from '@/lib/data/types'
import { FacebookIcon, InstagramIcon } from './brand-icons'
import { Avatar, Logo, buttonClass, cx, formatCompact, formatNumber } from './ui'

const NAV = [
  { href: '/home', label: 'Home', icon: House },
  { href: '/automations', label: 'Automations', icon: Zap },
  { href: '/contacts', label: 'Contacts', icon: Users },
]

interface SidebarProps {
  account: ConnectedAccount
  accounts: ConnectedAccount[]
  subscription: Subscription
}

export function Sidebar(props: SidebarProps) {
  return (
    <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col gap-5 border-r border-line bg-sand px-4 py-5 lg:flex">
      <SidebarBody {...props} />
    </aside>
  )
}

/** Below md the sidebar is replaced by a slim top bar whose menu button opens the same content as a drawer. */
export function MobileNav(props: SidebarProps) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="lg:hidden">
      <div className="flex items-center justify-between border-b border-line bg-sand px-4 py-3">
        <Link href="/home">
          <Logo />
        </Link>
        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen(true)}
          className="grid size-10 place-items-center rounded-xl border border-line bg-white"
        >
          <Menu className="size-4" />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <aside
            id="mobile-nav"
            className="relative flex h-full w-[280px] max-w-[85vw] flex-col gap-5 overflow-y-auto bg-sand px-4 py-5"
          >
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className="absolute top-4 right-3 grid size-8 place-items-center rounded-lg text-muted hover:bg-white"
            >
              <X className="size-4" />
            </button>
            <SidebarBody {...props} />
          </aside>
        </div>
      )}
    </div>
  )
}

function SidebarBody({ account, accounts, subscription }: SidebarProps) {
  const pathname = usePathname()
  const usage = subscription.contactsReached / subscription.contactsLimit
  const daysLeft = Math.max(0, Math.ceil((new Date(subscription.periodEnd).getTime() - Date.now()) / 86_400_000))

  return (
    <>
      <Link href="/home" className="px-2 py-1">
        <Logo />
      </Link>

      <AccountSwitcher account={account} accounts={accounts} />

      <nav className="flex flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => (
          <NavLink key={href} href={href} active={pathname.startsWith(href)}>
            <Icon className="size-[18px]" strokeWidth={1.75} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto rounded-[18px] bg-ink p-4 text-white">
        <div className="flex items-center justify-between text-[13px]">
          <span className="font-semibold">Contacts reached</span>
          <span className="text-white/60">
            {formatCompact(subscription.contactsReached)} / {formatCompact(subscription.contactsLimit)}
          </span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full bg-lime" style={{ width: `${Math.min(100, usage * 100)}%` }} />
        </div>
        <p className="mt-3 text-[12.5px] leading-snug text-white/60">
          <span className="capitalize">{subscription.plan}</span> plan · resets in {daysLeft} days.{' '}
          {formatNumber(subscription.contactsLimit - subscription.contactsReached)} left.
        </p>
        <Link href="/settings#billing" className={cx(buttonClass('lime', 'sm'), 'mt-3 w-full')}>
          Upgrade plan
        </Link>
      </div>

      <div className="flex flex-col gap-1">
        <NavLink href="/settings" active={pathname.startsWith('/settings')}>
          <Settings className="size-[18px]" strokeWidth={1.75} />
          Settings
        </NavLink>
        <NavLink href="mailto:help@replyooo.com" active={false}>
          <CircleHelp className="size-[18px]" strokeWidth={1.75} />
          Help
        </NavLink>
        <form action={signOut}>
          <button type="submit" className={navItemClass(false)}>
            <LogOut className="size-[18px]" strokeWidth={1.75} />
            Log out
          </button>
        </form>
      </div>
    </>
  )
}

const navItemClass = (active: boolean) =>
  cx(
    'flex h-[38px] w-full items-center gap-3 rounded-[10px] px-3 text-[14.5px] transition-colors',
    active ? 'border border-line bg-white font-semibold text-ink shadow-[0_1px_2px_rgba(21,19,16,0.04)]' : 'text-muted hover:bg-white/60 hover:text-ink',
  )

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={navItemClass(active)}>
      {children}
    </Link>
  )
}

export function PlatformIcon({ platform, className }: { platform: ConnectedAccount['platform']; className?: string }) {
  const Icon = platform === 'instagram' ? InstagramIcon : FacebookIcon
  return <Icon className={cx('size-3.5', className)} />
}

function AccountSwitcher({ account, accounts }: { account: ConnectedAccount; accounts: ConnectedAccount[] }) {
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cx(
          'flex w-full items-center gap-2.5 rounded-[14px] border border-line bg-white p-2.5 text-left transition-opacity hover:border-faint',
          pending && 'opacity-60',
        )}
      >
        <Avatar name={account.username} size={32} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold">@{account.username}</span>
          <span className="flex items-center gap-1 text-[11.5px] text-subtle">
            <PlatformIcon platform={account.platform} className="size-3" />
            {account.followers !== null
              ? `${formatCompact(account.followers)} followers`
              : account.platform === 'instagram'
                ? 'Instagram'
                : 'Facebook Page'}
          </span>
        </span>
        <ChevronsUpDown className="size-4 text-subtle" />
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-20 mt-1.5 rounded-[14px] border border-line bg-white p-1.5 shadow-[0_12px_32px_rgba(21,19,16,0.12)]">
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setOpen(false)
                startTransition(() => switchAccount(a.id))
              }}
              className="flex w-full items-center gap-2.5 rounded-[10px] p-2 text-left hover:bg-sand"
            >
              <Avatar name={a.username} size={26} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">@{a.username}</span>
                <span className="flex items-center gap-1 text-[11px] text-subtle">
                  <PlatformIcon platform={a.platform} className="size-3" />
                  {a.platform === 'instagram' ? 'Instagram' : 'Facebook Page'}
                  {a.status === 'reauth_required' && <span className="text-brand">· reconnect</span>}
                </span>
              </span>
              {a.id === account.id && <Check className="size-4 text-ink" />}
            </button>
          ))}
          <Link
            href="/connect"
            onClick={() => setOpen(false)}
            className="mt-1 flex items-center gap-2 rounded-[10px] border-t border-line p-2 pt-2.5 text-[13px] font-medium text-muted hover:bg-sand hover:text-ink"
          >
            <Plus className="size-4" /> Connect another account
          </Link>
        </div>
      )}
    </div>
  )
}
