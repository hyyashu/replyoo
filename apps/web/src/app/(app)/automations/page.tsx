import { CircleCheckBig, LayoutTemplate, Mail, Plus, Send, Users } from 'lucide-react'
import type { Metadata } from 'next'
import { ButtonLink, PageHeader, StatCard, formatNumber, formatPercent } from '@/components/ui'
import { getHomeStats, listAutomations } from '@/lib/data'
import { getCurrentAccount } from '@/lib/session'
import { AutomationsTable } from './automations-table'

export const metadata: Metadata = { title: 'Automations' }

export default async function AutomationsPage() {
  const { workspace, account } = await getCurrentAccount()
  const [automations, stats] = await Promise.all([listAutomations(workspace.workspaceId, account.id), getHomeStats(workspace.workspaceId, account.id)])
  const surfaces = account.platform === 'instagram' ? 'comments, stories and DMs' : 'comments and Messenger'

  return (
    <div className="mx-auto max-w-[1180px] px-10 py-9">
      <PageHeader
        title="Automations"
        subtitle={`${stats.liveCount} live · replying to ${surfaces} on @${account.username}`}
        actions={
          <>
            <ButtonLink href="/automations/new" variant="secondary">
              <LayoutTemplate className="size-4" /> Templates
            </ButtonLink>
            <ButtonLink href="/automations/new">
              New automation <Plus className="size-4" />
            </ButtonLink>
          </>
        }
      />

      <div className="mt-7 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="DMs sent" value={formatNumber(stats.dmsSent)} icon={<Send className="size-4" />} hint="Last 30 days" />
        <StatCard label="Runs started" value={formatNumber(stats.runs)} icon={<Users className="size-4" />} hint="Last 30 days" />
        <StatCard
          label="Completion rate"
          value={formatPercent(stats.completionRate)}
          icon={<CircleCheckBig className="size-4" />}
          hint="Runs that reached the end"
        />
        <StatCard label="Leads captured" value={formatNumber(stats.leads)} icon={<Mail className="size-4" />} hint="Emails and phone numbers" />
      </div>

      <AutomationsTable automations={automations} />
    </div>
  )
}
