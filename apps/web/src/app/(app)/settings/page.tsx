import { PLAN_NAMES } from '@replyooo/shared'
import { Check, Plus, TriangleAlert } from 'lucide-react'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import {
  deleteWorkspace,
  disconnectAccount,
  inviteMember,
  openBillingPortal,
  removeMember,
  revokeInvitation,
  switchPlan,
} from '@/app/actions'
import { ConfirmAction } from '@/components/confirm-action'
import { WorkspaceList } from '@/components/workspace-list'
import { PlatformIcon } from '@/components/sidebar'
import { Avatar, ButtonLink, Card, PageHeader, buttonClass, cx, formatCompact, formatNumber } from '@/components/ui'
import { dodoConfig } from '@/lib/billing/dodo'
import { displayPrices, planCards, requestCountry, saveLabel } from '@/lib/billing/pricing'
import { getSubscription, listAccounts, listInvitations, listMembers } from '@/lib/data'
import { db } from '@/lib/db'
import { requireWorkspace } from '@/lib/session'
import { canManage, listWorkspaces } from '@/lib/workspaces'
import { BillingPlans } from './billing-plans'

export const metadata: Metadata = { title: 'Settings' }

const INVITE_NOTICES: Record<string, string> = {
  invited: 'Invite sent. They join as soon as they sign in with that email address and confirm it.',
  member: 'That person is already in this workspace.',
  invalid: 'That doesn’t look like an email address.',
}

const NOTICES: Record<string, string> = {
  account_limit: 'Some Pages weren’t connected because your plan’s account limit is reached. Upgrade to connect more.',
}

const BILLING_NOTICES: Record<string, string> = {
  updated: 'Thanks! Your plan changes as soon as Dodo Payments confirms the payment, usually within a few seconds.',
  unavailable: 'Billing isn’t set up yet.',
  error: 'Dodo Payments didn’t respond. Try again in a minute.',
}
const PAYMENT_PROBLEMS = new Set(['on_hold', 'past_due', 'failed'])

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ invite?: string; notice?: string; billing?: string }> }) {
  const [{ invite, notice: pageNotice, billing }, workspace] = await Promise.all([searchParams, requireWorkspace()])
  const [accounts, members, invitations, subscription, workspaces] = await Promise.all([
    listAccounts(workspace.workspaceId),
    listMembers(workspace.workspaceId),
    listInvitations(workspace.workspaceId),
    getSubscription(workspace.workspaceId),
    listWorkspaces(db(), workspace.user.id),
  ])
  const manager = canManage(workspace.role)
  const usage = subscription.contactsReached / subscription.contactsLimit
  const notice = invite ? INVITE_NOTICES[invite] : undefined
  const billingEnabled = dodoConfig() !== null
  const prices = await displayPrices(requestCountry(await headers()))
  const billingNotice = billing ? BILLING_NOTICES[billing] : undefined

  return (
    <div className="mx-auto max-w-[920px] px-10 py-9">
      <PageHeader title="Settings" subtitle={workspace.workspaceName} />

      {pageNotice && NOTICES[pageNotice] && (
        <p role="status" className="mt-6 rounded-xl bg-brand-tint px-4 py-3 text-[13.5px] text-ink">
          {NOTICES[pageNotice]}
        </p>
      )}

      {workspaces.length > 1 && (
        <SettingsSection id="workspaces" title="Workspaces" description="Workspaces you belong to.">
          <WorkspaceList workspaces={workspaces} currentId={workspace.workspaceId} />
        </SettingsSection>
      )}

      <SettingsSection id="accounts" title="Connected accounts" description="Instagram professional accounts and Facebook Pages Replyooo replies on.">
        <Card className="divide-y divide-line">
          {accounts.map((account) => (
            <div key={account.id} className="flex flex-wrap items-center gap-3 p-4 sm:flex-nowrap">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar name={account.username} size={40} src={account.avatarUrl} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-semibold">@{account.username}</div>
                  <div className="flex items-center gap-1.5 text-[12.5px] text-subtle">
                    <PlatformIcon platform={account.platform} className="size-3 shrink-0" />
                    {account.platform === 'instagram' ? 'Instagram' : 'Facebook Page'}
                    {account.followers !== null && <> · {formatCompact(account.followers)} followers</>}
                  </div>
                </div>
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 pl-[52px] sm:w-auto sm:flex-nowrap sm:pl-0">
                {account.status === 'reauth_required' ? (
                  <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold whitespace-nowrap text-brand">
                    <TriangleAlert className="size-3.5" /> Needs reconnect
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold whitespace-nowrap text-green">
                    <Check className="size-3.5" /> Connected
                  </span>
                )}
                {account.status === 'reauth_required' && (
                  <ButtonLink href={`/connect?platform=${account.platform}`} size="sm">
                    Reconnect
                  </ButtonLink>
                )}
                {manager && (
                  <ConfirmAction
                    action={disconnectAccount.bind(null, account.id)}
                    label="Disconnect"
                    title={`Disconnect @${account.username}?`}
                    description="Automations on this account will stop replying until you connect it again. Your contacts and message history are kept."
                  />
                )}
              </div>
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
            <div key={member.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
              <Avatar name={member.name} size={36} />
              <div className="min-w-0 flex-1 basis-40">
                <div className="text-[14px] font-semibold">
                  {member.name}
                  {member.userId === workspace.user.id && <span className="font-normal text-subtle"> (you)</span>}
                </div>
                <div className="text-[12.5px] break-all text-subtle">{member.email}</div>
              </div>
              <span className="rounded-full bg-sand px-2.5 py-0.5 text-[12px] font-medium capitalize">{member.role}</span>
              {manager && member.role !== 'owner' && member.userId !== workspace.user.id && (
                <ConfirmAction
                  action={removeMember.bind(null, member.id)}
                  label="Remove"
                  title={`Remove ${member.name}?`}
                  description="They lose access to this workspace’s automations and contacts straight away. You can invite them again later."
                />
              )}
            </div>
          ))}
          {invitations.map((invitation) => (
            <div key={invitation.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
              <Avatar name={invitation.email} size={36} />
              <div className="min-w-0 flex-1 basis-40">
                <div className="text-[14px] font-semibold break-all">{invitation.email}</div>
                <div className="text-[12.5px] text-subtle">Invited · joins when they sign up or log in with this email</div>
              </div>
              <span className="rounded-full bg-cream px-2.5 py-0.5 text-[12px] font-medium">Pending</span>
              {manager && (
                <ConfirmAction
                  action={revokeInvitation.bind(null, invitation.id)}
                  label="Revoke"
                  title={`Revoke the invite for ${invitation.email}?`}
                  description="The invite stops working. You can send a new one later."
                />
              )}
            </div>
          ))}
          {manager && (
            <form action={inviteMember} className="flex flex-col gap-2 p-4">
              <div className="flex gap-2">
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
              </div>
              {notice && <p className="text-[12.5px] text-muted">{notice}</p>}
            </form>
          )}
        </Card>
      </SettingsSection>

      <SettingsSection id="billing" title="Billing" description="Plans are metered on contacts reached per month.">
        {billingNotice && <p role="status" className="mb-3 text-[13px] text-muted">{billingNotice}</p>}
        {manager && subscription.billedPlan !== 'free' && PAYMENT_PROBLEMS.has(subscription.status) && (
          <Card className="mb-4 flex items-center gap-3 border-[#ffb59a] p-4 text-[13.5px]">
            <TriangleAlert className="size-4 shrink-0 text-brand" />
            Your last payment didn’t go through. Update your payment method to keep {PLAN_NAMES[subscription.billedPlan]}.
            {billingEnabled && subscription.hasBillingAccount && (
              <form action={openBillingPortal} className="ml-auto">
                <button type="submit" className={buttonClass('dark', 'sm')}>
                  Update payment
                </button>
              </form>
            )}
          </Card>
        )}
        <Card className="p-5">
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] font-semibold">This month</span>
            <span className="text-[13px] text-subtle">
              {formatNumber(subscription.contactsReached)} / {formatNumber(subscription.contactsLimit)} contacts reached
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-sand">
            <div className="h-full rounded-full bg-ink" style={{ width: `${Math.min(100, usage * 100)}%` }} />
          </div>
          {subscription.renewsAt && subscription.plan !== 'free' && (
            <p className="mt-3 text-[12.5px] text-subtle">
              {PLAN_NAMES[subscription.plan]} ({subscription.billedInterval === 'year' ? 'yearly' : 'monthly'}) renews on{' '}
              {new Date(subscription.renewsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.
            </p>
          )}
        </Card>
        <BillingPlans
          cards={planCards(prices)}
          yearly={prices.yearly}
          saveLabel={saveLabel(prices)}
          current={{ plan: subscription.plan, interval: subscription.billedInterval }}
          canAct={manager && billingEnabled}
          hasBillingAccount={subscription.hasBillingAccount}
          switchPlan={switchPlan}
          openBillingPortal={openBillingPortal}
        />
        {manager && billingEnabled && subscription.hasBillingAccount && (
          <form action={openBillingPortal} className="mt-4">
            <button type="submit" className="text-[13px] font-semibold text-ink hover:underline">
              Manage billing and invoices →
            </button>
          </form>
        )}
        {!billingEnabled && <p className="mt-4 text-[12.5px] text-subtle">Billing isn’t set up yet. Plans can be changed once payments are configured.</p>}
        {billingEnabled && !manager && <p className="mt-4 text-[12.5px] text-subtle">Only owners and admins can change the plan.</p>}
      </SettingsSection>

      {workspace.role === 'owner' && (
        <SettingsSection id="danger" title="Delete workspace" description="Deletes every automation, contact and message, and disconnects all accounts. This can’t be undone.">
          <Card className="border-[#ffb59a] p-5">
            <form action={deleteWorkspace} className="flex flex-wrap items-center gap-2">
              <input
                name="confirm"
                required
                placeholder={`Type “${workspace.workspaceName}” to confirm`}
                className="h-9 flex-1 rounded-full border border-line px-4 text-[13.5px] outline-none focus:border-ink"
              />
              <button type="submit" className="h-9 rounded-full bg-[#c2330e] px-4 text-[13px] font-semibold text-white hover:bg-[#a52a0a]">
                Delete workspace
              </button>
            </form>
          </Card>
        </SettingsSection>
      )}
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
