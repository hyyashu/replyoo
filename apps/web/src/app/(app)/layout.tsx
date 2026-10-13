import { getDashboardFormatters } from '@/i18n/server-format'

import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { TriangleAlert } from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { signOut } from '@/app/auth-actions'
import { MobileNav, Sidebar } from '@/components/sidebar'
import { Logo } from '@/components/ui'
import { VerifyEmailBanner } from '@/components/verify-banner'
import { getSubscription } from '@/lib/data'
import { getAccountContext, VERIFY_COOLDOWN_COOKIE } from '@/lib/session'
import { DashboardProvider } from '@/i18n/provider'
import { DocumentLanguage } from '@/i18n/document-language'
import { LanguageSelector } from '@/components/language-selector'

function SkipLink() {
  const tr = useTranslations('navigation')
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-[13px] focus:text-white"
    >
      {tr('skip_to_content')}
    </a>
  )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProvider namespaces={[]}>
      <DocumentLanguage />
      <AppShell>{children}</AppShell>
    </DashboardProvider>
  )
}

async function AppShell({ children }: { children: React.ReactNode }) {
  const { formatNumber, formatDate } = await getDashboardFormatters()
  const tr = await getTranslations('navigation')
  const { workspace, account, accounts } = await getAccountContext()
  const subscription = await getSubscription(workspace.workspaceId)
  const verifyBanner = workspace.user.emailVerified ? null : (
    <VerifyEmailBanner email={workspace.user.email} sent={(await cookies()).has(VERIFY_COOLDOWN_COOKIE)} />
  )

  // No connected account: only Settings and /connect are usable; every other page redirects itself.
  if (!account) {
    return (
      <div className="min-h-screen bg-sand">
        <SkipLink />
        <header className="flex items-center justify-between px-4 py-6 sm:px-8">
          <Link href="/connect">
            <Logo />
          </Link>
          <div className="flex items-center gap-5 text-[13.5px] font-medium text-muted">
            <LanguageSelector compact />
            <Link href="/connect" className="hover:text-ink">
              {tr('connect_an_account')}
            </Link>
            <form action={signOut}>
              <button type="submit" className="font-medium hover:text-ink">
                {tr('log_out')}
              </button>
            </form>
          </div>
        </header>
        {verifyBanner}
        <main id="main">{children}</main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <SkipLink />
      <MobileNav account={account} accounts={accounts} subscription={subscription} />
      <Sidebar account={account} accounts={accounts} subscription={subscription} />
      <main id="main" className="min-w-0 flex-1">
        {verifyBanner}
        {account.status === 'reauth_required' && (
          <div className="flex flex-wrap items-center gap-2 border-b border-[#ffd7c4] bg-brand-tint px-4 py-2.5 sm:px-10 text-[13.5px] text-ink">
            <TriangleAlert className="size-4 text-brand" />
            {tr('reauthNotice', { username: account.username })}{' '}
            <Link href={`/connect?platform=${account.platform}`} className="ml-auto font-semibold text-brand hover:underline">
              {tr('reconnect')}
            </Link>
          </div>
        )}
        {subscription.contactsReached >= subscription.contactsLimit && (
          <div className="flex flex-wrap items-center gap-2 border-b border-[#ffd7c4] bg-brand-tint px-4 py-2.5 sm:px-10 text-[13.5px] text-ink">
            <TriangleAlert className="size-4 text-brand" />
            {tr('contactLimitNotice', {
              count: formatNumber(subscription.contactsLimit),
              date: formatDate(subscription.periodEnd, { month: 'short', day: 'numeric' }),
            })}
            <Link href="/settings#billing" className="ml-auto font-semibold text-brand hover:underline">
              {tr('upgrade')}
            </Link>
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
