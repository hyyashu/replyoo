import { getDashboardFormatters } from '@/i18n/server-format'

import { getTranslations } from 'next-intl/server'
import { ArrowRight, AtSign, CircleCheckBig, Phone, Plus, Send, Users } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Avatar, ButtonLink, Card, PageHeader, StatCard, StatusPill } from '@/components/ui'
import { getHomeStats, getSubscription, listAutomations, listLatestLeads } from '@/lib/data'
import { triggerLabel } from '@/lib/describe'
import { getCurrentAccount } from '@/lib/session'
import { TriggerIcon } from '../automations/automations-table'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('home'))('pageTitle') }
}

export default async function HomePage() {
  const { formatNumber, formatPercent, formatDate, timeAgo } = await getDashboardFormatters()
  const tr = await getTranslations('home')
  const describe = await getTranslations('shared')
  const common = await getTranslations('common')
  const { workspace, account } = await getCurrentAccount()
  const [stats, subscription, automations, leads] = await Promise.all([
    getHomeStats(workspace.workspaceId, account.id),
    getSubscription(workspace.workspaceId),
    listAutomations(workspace.workspaceId, account.id),
    listLatestLeads(workspace.workspaceId, account.id),
  ])
  const top = automations.filter((a) => a.status !== 'draft').slice(0, 4)
  const usage = subscription.contactsReached / subscription.contactsLimit
  const firstName = workspace.user.name.split(' ')[0]

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-6 sm:px-10 sm:py-9">
      <PageHeader
        title={tr('hey', { v0: firstName ?? workspace.user.name })}
        subtitle={tr('here_s_how_is_doing_this_month', { v0: account.username })}
        actions={
          <ButtonLink href="/automations/new">
            {tr('new_automation')} <Plus className="size-4" />
          </ButtonLink>
        }
      />

      <div className="mt-7 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={tr('contacts_reached')}
          value={formatNumber(subscription.contactsReached)}
          icon={<Users className="size-4" />}
          hint={tr('this_billing_period')}
        />
        <StatCard
          label={tr('leads_captured')}
          value={formatNumber(stats.leads)}
          icon={<AtSign className="size-4" />}
          hint={tr('emails_and_phone_numbers')}
        />
        <StatCard label={tr('dms_sent')} value={formatNumber(stats.dmsSent)} icon={<Send className="size-4" />} hint={tr('last_30_days')} />
        <StatCard
          label={tr('completion_rate')}
          value={formatPercent(stats.completionRate)}
          icon={<CircleCheckBig className="size-4" />}
          hint={tr('runs_that_reached_the_end')}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="self-start overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h2 className="text-[16px] font-semibold">{tr('top_automations')}</h2>
            <Link href="/automations" className="inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink">
              {tr('view_all')} <ArrowRight className="size-3.5" />
            </Link>
          </div>
          {top.length === 0 ? (
            <p className="px-5 pb-6 text-[14px] text-muted">{tr('nothing_live_yet_publish_an_automation_to_see_it_here')}</p>
          ) : (
            <ul>
              {top.map((a) => (
                <li key={a.id} className="border-t border-line">
                  <Link href={`/automations/${a.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-sand/40">
                    <TriggerIcon type={a.flow.trigger.type} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-semibold">{a.name}</span>
                      <span className="text-[12.5px] text-subtle">{triggerLabel(a.flow.trigger, describe)}</span>
                    </span>
                    <span className="text-right">
                      <span className="block text-[14.5px] font-semibold tabular-nums">{formatNumber(a.stats.runs)}</span>
                      <span className="text-[12px] text-subtle">{tr('runs')}</span>
                    </span>
                    <span className="w-20 text-right">
                      <StatusPill label={common(`status_${a.status}`)} status={a.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-semibold">{tr('plan_usage')}</h2>
              <span className="rounded-full bg-sand px-2.5 py-0.5 text-[12px] font-semibold capitalize">{common(`plan_${subscription.plan}`)}</span>
            </div>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span className="font-display text-[28px] font-bold tracking-[-0.04em]">{formatNumber(subscription.contactsReached)}</span>
              <span className="text-[13px] text-subtle">{tr('contacts', { v0: formatNumber(subscription.contactsLimit) })}</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-sand">
              <div
                className={usage > 0.9 ? 'h-full rounded-full bg-brand' : 'h-full rounded-full bg-ink'}
                style={{ width: `${Math.min(100, usage * 100)}%` }}
              />
            </div>
            <p className="mt-3 text-[13px] text-muted">
              {tr('when_you_hit_the_limit_new_conversations_pause_until', {
                v0: formatDate(subscription.periodEnd, { month: 'short', day: 'numeric' }),
              })}
            </p>
            <ButtonLink href="/settings#billing" variant="secondary" size="sm" className="mt-4">
              {tr('upgrade_plan')}
            </ButtonLink>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h2 className="text-[16px] font-semibold">{tr('latest_leads')}</h2>
              <Link href="/contacts?has=email" className="inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink">
                {tr('all')} <ArrowRight className="size-3.5" />
              </Link>
            </div>
            {leads.length === 0 ? (
              <p className="px-5 pb-6 text-[14px] text-muted">{tr('turn_on_ask_for_email_in_an_automation_to_start_collecting')}</p>
            ) : (
              <ul>
                {leads.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 border-t border-line px-5 py-3">
                    <Avatar name={c.username} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold">@{c.username}</span>
                      <span className="flex items-center gap-1 truncate text-[12px] text-subtle">
                        {c.email ? <AtSign className="size-3" /> : <Phone className="size-3" />}
                        {c.email ?? c.phone}
                      </span>
                    </span>
                    <span className="text-[12px] text-subtle">{timeAgo(c.lastInboundAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
