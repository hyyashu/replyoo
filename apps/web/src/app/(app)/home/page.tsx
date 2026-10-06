import { ArrowRight, AtSign, CircleCheckBig, Phone, Plus, Send, Users } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Avatar, ButtonLink, Card, PageHeader, StatCard, StatusPill, formatNumber, formatPercent, timeAgo } from '@/components/ui'
import { getHomeStats, getSubscription, listAutomations, listLatestLeads } from '@/lib/data'
import { triggerLabel } from '@/lib/describe'
import { getCurrentAccount } from '@/lib/session'
import { TriggerIcon } from '../automations/automations-table'

export const metadata: Metadata = { title: 'Home' }

export default async function HomePage() {
  const { workspace, account } = await getCurrentAccount()
  const [stats, subscription, automations, leads] = await Promise.all([
    getHomeStats(workspace.workspaceId, account.id),
    getSubscription(),
    listAutomations(workspace.workspaceId, account.id),
    listLatestLeads(workspace.workspaceId, account.id),
  ])
  const top = automations.filter((a) => a.status !== 'draft').slice(0, 4)
  const usage = subscription.contactsReached / subscription.contactsLimit
  const firstName = workspace.user.name.split(' ')[0]

  return (
    <div className="mx-auto max-w-[1180px] px-10 py-9">
      <PageHeader
        title={`Hey ${firstName} 👋`}
        subtitle={`Here’s how @${account.username} is doing this month.`}
        actions={
          <ButtonLink href="/automations/new">
            New automation <Plus className="size-4" />
          </ButtonLink>
        }
      />

      <div className="mt-7 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Contacts reached"
          value={formatNumber(subscription.contactsReached)}
          icon={<Users className="size-4" />}
          hint="This billing period"
        />
        <StatCard label="Leads captured" value={formatNumber(stats.leads)} icon={<AtSign className="size-4" />} hint="Emails and phone numbers" />
        <StatCard label="DMs sent" value={formatNumber(stats.dmsSent)} icon={<Send className="size-4" />} hint="Last 30 days" />
        <StatCard
          label="Completion rate"
          value={formatPercent(stats.completionRate)}
          icon={<CircleCheckBig className="size-4" />}
          hint="Runs that reached the end"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="self-start overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h2 className="text-[16px] font-semibold">Top automations</h2>
            <Link href="/automations" className="inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink">
              View all <ArrowRight className="size-3.5" />
            </Link>
          </div>
          {top.length === 0 ? (
            <p className="px-5 pb-6 text-[14px] text-muted">Nothing live yet — publish an automation to see it here.</p>
          ) : (
            <ul>
              {top.map((a) => (
                <li key={a.id} className="border-t border-line">
                  <Link href={`/automations/${a.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-sand/40">
                    <TriggerIcon type={a.flow.trigger.type} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-semibold">{a.name}</span>
                      <span className="text-[12.5px] text-subtle">{triggerLabel(a.flow.trigger)}</span>
                    </span>
                    <span className="text-right">
                      <span className="block text-[14.5px] font-semibold tabular-nums">{formatNumber(a.stats.runs)}</span>
                      <span className="text-[12px] text-subtle">runs</span>
                    </span>
                    <span className="w-20 text-right">
                      <StatusPill status={a.status} />
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
              <h2 className="text-[16px] font-semibold">Plan usage</h2>
              <span className="rounded-full bg-sand px-2.5 py-0.5 text-[12px] font-semibold capitalize">{subscription.plan}</span>
            </div>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span className="font-display text-[28px] font-bold tracking-[-0.04em]">{formatNumber(subscription.contactsReached)}</span>
              <span className="text-[13px] text-subtle">/ {formatNumber(subscription.contactsLimit)} contacts</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-sand">
              <div
                className={usage > 0.9 ? 'h-full rounded-full bg-brand' : 'h-full rounded-full bg-ink'}
                style={{ width: `${Math.min(100, usage * 100)}%` }}
              />
            </div>
            <p className="mt-3 text-[13px] text-muted">
              When you hit the limit, new conversations pause until {new Date(subscription.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
            </p>
            <ButtonLink href="/settings#billing" variant="secondary" size="sm" className="mt-4">
              Upgrade plan
            </ButtonLink>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h2 className="text-[16px] font-semibold">Latest leads</h2>
              <Link href="/contacts?has=email" className="inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink">
                All <ArrowRight className="size-3.5" />
              </Link>
            </div>
            {leads.length === 0 ? (
              <p className="px-5 pb-6 text-[14px] text-muted">Turn on “Ask for email” in an automation to start collecting leads.</p>
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
