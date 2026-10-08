import { TriangleAlert } from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { signOut } from '@/app/auth-actions'
import { MobileNav, Sidebar } from '@/components/sidebar'
import { Logo } from '@/components/ui'
import { VerifyEmailBanner } from '@/components/verify-banner'
import { getSubscription } from '@/lib/data'
import { getAccountContext, VERIFY_COOLDOWN_COOKIE } from '@/lib/session'

function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-[13px] focus:text-white"
    >
      Skip to content
    </a>
  )
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
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
            <Link href="/connect" className="hover:text-ink">
              Connect an account
            </Link>
            <form action={signOut}>
              <button type="submit" className="font-medium hover:text-ink">
                Log out
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
            Meta revoked access to @{account.username}. Automations on this account are paused until you reconnect.
            <Link href={`/connect?platform=${account.platform}`} className="ml-auto font-semibold text-brand hover:underline">
              Reconnect
            </Link>
          </div>
        )}
        {subscription.contactsReached >= subscription.contactsLimit && (
          <div className="flex flex-wrap items-center gap-2 border-b border-[#ffd7c4] bg-brand-tint px-4 py-2.5 sm:px-10 text-[13.5px] text-ink">
            <TriangleAlert className="size-4 text-brand" />
            You’ve reached {subscription.contactsLimit.toLocaleString('en-US')} contacts this month. New conversations are paused until{' '}
            {new Date(subscription.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
            <Link href="/settings#billing" className="ml-auto font-semibold text-brand hover:underline">
              Upgrade
            </Link>
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
