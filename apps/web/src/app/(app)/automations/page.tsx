import { getDashboardFormatters } from '@/i18n/server-format'

import { getTranslations } from 'next-intl/server'
import { CircleCheckBig, LayoutTemplate, Mail, Plus, Send, Users } from 'lucide-react'
import type { Metadata } from 'next'
import { ButtonLink, PageHeader, StatCard } from '@/components/ui'
import { getHomeStats, listAutomations } from '@/lib/data'
import { getCurrentAccount } from '@/lib/session'
import { AutomationsTable } from './automations-table'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('automations'))('pageTitle') }
}

export default async function AutomationsPage() {
  const { formatNumber, formatPercent } = await getDashboardFormatters()
  const tr = await getTranslations('automations')
  const { workspace, account } = await getCurrentAccount()
  const [automations, stats] = await Promise.all([
    listAutomations(workspace.workspaceId, account.id),
    getHomeStats(workspace.workspaceId, account.id),
  ])
  const surfaces = account.platform === 'instagram' ? tr('comments_stories_dms') : tr('comments_and_messenger')

  return (
    <div className="mx-auto max-w-[1180px] px-10 py-9">
      <PageHeader
        title={tr('automations')}
        subtitle={tr('live_replying_to_on', { v0: stats.liveCount, v1: surfaces, v2: account.username })}
        actions={
          <>
            <ButtonLink href="/automations/new" variant="secondary">
              <LayoutTemplate className="size-4" /> {tr('templates')}{' '}
            </ButtonLink>
            <ButtonLink href="/automations/new">
              {tr('new_automation')} <Plus className="size-4" />
            </ButtonLink>
          </>
        }
      />

      <div className="mt-7 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={tr('dms_sent')} value={formatNumber(stats.dmsSent)} icon={<Send className="size-4" />} hint={tr('last_30_days')} />
        <StatCard label={tr('runs_started')} value={formatNumber(stats.runs)} icon={<Users className="size-4" />} hint={tr('last_30_days')} />
        <StatCard
          label={tr('completion_rate')}
          value={formatPercent(stats.completionRate)}
          icon={<CircleCheckBig className="size-4" />}
          hint={tr('runs_that_reached_the_end')}
        />
        <StatCard
          label={tr('leads_captured')}
          value={formatNumber(stats.leads)}
          icon={<Mail className="size-4" />}
          hint={tr('emails_and_phone_numbers')}
        />
      </div>

      <AutomationsTable automations={automations} />
    </div>
  )
}
