import { TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { signOut } from '@/app/auth-actions'
import { Sidebar } from '@/components/sidebar'
import { Logo } from '@/components/ui'
import { getSubscription } from '@/lib/data'
import { getAccountContext } from '@/lib/session'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { workspace, account, accounts } = await getAccountContext()
  const subscription = await getSubscription(workspace.workspaceId)

  // No connected account: only Settings and /connect are usable; every other page redirects itself.
  if (!account) {
    return (
      <div className="min-h-screen bg-sand">
        <header className="flex items-center justify-between px-8 py-6">
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
        <main>{children}</main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar account={account} accounts={accounts} subscription={subscription} />
      <main className="min-w-0 flex-1">
        {account.status === 'reauth_required' && (
          <div className="flex items-center gap-2 border-b border-[#ffd7c4] bg-brand-tint px-10 py-2.5 text-[13.5px] text-ink">
            <TriangleAlert className="size-4 text-brand" />
            Meta revoked access to @{account.username}. Automations on this account are paused until you reconnect.
            <Link href={`/connect?platform=${account.platform}`} className="ml-auto font-semibold text-brand hover:underline">
              Reconnect
            </Link>
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
