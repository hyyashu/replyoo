import { TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { Sidebar } from '@/components/sidebar'
import { getSubscription } from '@/lib/data'
import { getCurrentAccount } from '@/lib/session'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { workspace, account, accounts } = await getCurrentAccount()
  const subscription = await getSubscription(workspace.workspaceId)

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
