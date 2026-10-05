import { Check, Plus, TriangleAlert } from 'lucide-react'
import type { Metadata } from 'next'
import { deleteWorkspace, disconnectAccount, inviteMember, removeMember } from '@/app/actions'
import { PlatformIcon } from '@/components/sidebar'
import { Avatar, ButtonLink, Card, PageHeader, buttonClass, cx, formatCompact, formatNumber } from '@/components/ui'
import { getSubscription, getWorkspace, listAccounts, listMembers } from '@/lib/data'

export const metadata: Metadata = { title: 'Settings' }

const PLANS = [
  { key: 'free', name: 'Free', price: '$0', contacts: 1_000, features: ['1 connected account', '3 live automations', 'Replyooo branding'] },
  { key: 'pro', name: 'Pro', price: '$12', contacts: 5_000, features: ['3 connected accounts', 'Unlimited automations', 'Follow gate & lead capture'] },
  { key: 'business', name: 'Business', price: '$29', contacts: 25_000, features: ['10 connected accounts', 'Team members', 'Priority support'] },
] as const

export default async function SettingsPage() {
  const [workspace, accounts, members, subscription] = await Promise.all([
    getWorkspace(),
    listAccounts(),
    listMembers(),
    getSubscription(),
  ])
  const usage = subscription.contactsReached / subscription.contactsLimit

  return (
    <div className="mx-auto max-w-[920px] px-10 py-9">
      <PageHeader title="Settings" subtitle={workspace.name} />

      <SettingsSection id="accounts" title="Connected accounts" description="Instagram professional accounts and Facebook Pages Replyooo replies on.">
        <Card className="divide-y divide-line">
          {accounts.map((account) => (
            <div key={account.id} className="flex items-center gap-3 p-4">
              <Avatar name={account.username} size={40} />
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-semibold">@{account.username}</div>
                <div className="flex items-center gap-1.5 text-[12.5px] text-subtle">
                  <PlatformIcon platform={account.platform} className="size-3" />
                  {account.platform === 'instagram' ? 'Instagram' : 'Facebook Page'} · {formatCompact(account.followers)} followers
                </div>
              </div>
              {account.status === 'reauth_required' ? (
                <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-brand">
                  <TriangleAlert className="size-3.5" /> Needs reconnect
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-green">
                  <Check className="size-3.5" /> Connected
                </span>
              )}
              {account.status === 'reauth_required' && (
                <ButtonLink href={`/connect?platform=${account.platform}`} size="sm">
                  Reconnect
                </ButtonLink>
              )}
              <form action={disconnectAccount.bind(null, account.id)}>
                <button type="submit" className={buttonClass('ghost', 'sm')}>
                  Disconnect
                </button>
              </form>
            </div>
          ))}
          <div className="p-4">
            <ButtonLink href="/connect" variant="secondary" size="sm">
              <Plus className="size-4" /> Connect account
            </ButtonLink>
          </div>
        </Card>
      </SettingsSection>

      <SettingsSection id="members" title="Members" description="People who can edit automations and see contacts.">
        <Card className="divide-y divide-line">
          {members.map((member) => (
            <div key={member.id} className="flex items-center gap-3 p-4">
              <Avatar name={member.name} size={36} />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold">{member.name}</div>
                <div className="text-[12.5px] text-subtle">{member.email}</div>
              </div>
              <span className="rounded-full bg-sand px-2.5 py-0.5 text-[12px] font-medium capitalize">{member.role}</span>
              {member.role !== 'owner' && (
                <form action={removeMember.bind(null, member.id)}>
                  <button type="submit" className={buttonClass('ghost', 'sm')}>
                    Remove
                  </button>
                </form>
              )}
            </div>
          ))}
          <form action={inviteMember} className="flex gap-2 p-4">
            <input
              name="email"
              type="email"
              required
              placeholder="teammate@example.com"
              className="h-9 flex-1 rounded-full border border-line px-4 text-[13.5px] outline-none focus:border-ink"
            />
            <button type="submit" className={buttonClass('dark', 'sm')}>
              Send invite
            </button>
          </form>
        </Card>
      </SettingsSection>

      <SettingsSection id="billing" title="Billing" description="Plans are metered on contacts reached per month.">
        <Card className="p-5">
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] font-semibold">This period</span>
            <span className="text-[13px] text-subtle">
              {formatNumber(subscription.contactsReached)} / {formatNumber(subscription.contactsLimit)} contacts reached
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-sand">
            <div className="h-full rounded-full bg-ink" style={{ width: `${Math.min(100, usage * 100)}%` }} />
          </div>
        </Card>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {PLANS.map((plan) => {
            const current = plan.key === subscription.plan
            return (
              <Card key={plan.key} className={cx('flex flex-col p-5', current && 'border-ink ring-1 ring-ink')}>
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-semibold">{plan.name}</span>
                  {current && <span className="rounded-full bg-lime px-2 py-0.5 text-[11px] font-semibold">Current</span>}
                </div>
                <div className="mt-2 font-display text-[30px] font-bold tracking-[-0.04em]">
                  {plan.price}
                  <span className="font-sans text-[13px] font-normal tracking-normal text-subtle">/month</span>
                </div>
                <ul className="mt-3 flex flex-col gap-1.5 text-[13px] text-muted">
                  <li>{formatNumber(plan.contacts)} contacts / month</li>
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                {/* Checkout and the customer portal are Dodo Payments links (Plan 4). */}
                <button type="button" disabled={current} className={cx(buttonClass(current ? 'secondary' : 'dark', 'sm'), 'mt-5')}>
                  {current ? 'Your plan' : `Switch to ${plan.name}`}
                </button>
              </Card>
            )
          })}
        </div>
      </SettingsSection>

      <SettingsSection id="danger" title="Delete workspace" description="Deletes every automation, contact and message, and disconnects all accounts. This can’t be undone.">
        <Card className="border-[#ffb59a] p-5">
          <form action={deleteWorkspace} className="flex flex-wrap items-center gap-2">
            <input
              name="confirm"
              required
              placeholder={`Type “${workspace.name}” to confirm`}
              className="h-9 flex-1 rounded-full border border-line px-4 text-[13.5px] outline-none focus:border-ink"
            />
            <button type="submit" className="h-9 rounded-full bg-[#c2330e] px-4 text-[13px] font-semibold text-white hover:bg-[#a52a0a]">
              Delete workspace
            </button>
          </form>
        </Card>
      </SettingsSection>
    </div>
  )
}

function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="mt-10 scroll-mt-8">
      <h2 className="text-[17px] font-semibold">{title}</h2>
      <p className="mt-0.5 mb-4 text-[13.5px] text-muted">{description}</p>
      {children}
    </section>
  )
}
