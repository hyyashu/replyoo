import { getDashboardFormatters } from '@/i18n/server-format'

import { PLAN_LIMITS } from '@replyooo/shared'
import { Check, Plus, TriangleAlert } from 'lucide-react'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { deleteWorkspace, disconnectAccount, inviteMember, openBillingPortal, removeMember, revokeInvitation, switchPlan } from '@/app/actions'
import { ConfirmAction } from '@/components/confirm-action'
import { WorkspaceList } from '@/components/workspace-list'
import { PlatformIcon } from '@/components/sidebar'
import { Avatar, ButtonLink, Card, PageHeader, buttonClass } from '@/components/ui'
import { dodoConfig } from '@/lib/billing/dodo'
import { displayPrices, planCards, requestCountry } from '@/lib/billing/pricing'
import { getSubscription, listAccounts, listInvitations, listMembers } from '@/lib/data'
import { db } from '@/lib/db'
import { requireWorkspace } from '@/lib/session'
import { canManage, listWorkspaces } from '@/lib/workspaces'
import { BillingPlans } from './billing-plans'
import { LanguageSelector } from '@/components/language-selector'
import { getLocale, getTranslations } from 'next-intl/server'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('pageTitle') }
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ invite?: string; notice?: string; billing?: string }> }) {
  const { formatCompact, formatNumber, formatDate } = await getDashboardFormatters()
  const tr = await getTranslations('settings')
  const BILLING_NOTICES: Record<string, string> = {
    updated: tr('thanks_your_plan_changes_as_soon_as_dodo_payments_confirms_the'),
    unavailable: tr('billing_isn_t_set_up_yet'),
    error: tr('dodo_payments_didn_t_respond_try_again_in_a_minute'),
  }
  const PAYMENT_PROBLEMS = new Set(['on_hold', 'past_due', 'failed'])
  const NOTICES: Record<string, string> = {
    account_limit: tr('some_pages_weren_t_connected_because_your_plan_s_account_limit'),
  }
  const INVITE_NOTICES: Record<string, string> = {
    invited: tr('invite_sent_they_join_as_soon_as_they_sign_in_with'),
    member: tr('that_person_is_already_in_this_workspace'),
    invalid: tr('that_doesn_t_look_like_an_email_address'),
  }
  const common = await getTranslations('common')
  const locale = await getLocale()
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
    <div className="mx-auto max-w-[920px] px-4 py-6 sm:px-10 sm:py-9">
      <PageHeader title={tr('settings')} subtitle={workspace.workspaceName} />
      <SettingsSection id="language" title={common('language')} description={common('languageDescription')}>
        <LanguageSelector />
      </SettingsSection>

      {pageNotice && NOTICES[pageNotice] && (
        <p role="status" className="mt-6 rounded-xl bg-brand-tint px-4 py-3 text-[13.5px] text-ink">
          {NOTICES[pageNotice]}
        </p>
      )}

      {workspaces.length > 1 && (
        <SettingsSection id="workspaces" title={tr('workspaces')} description={tr('workspaces_you_belong_to')}>
          <WorkspaceList workspaces={workspaces} currentId={workspace.workspaceId} />
        </SettingsSection>
      )}

      <SettingsSection
        id="accounts"
        title={tr('connected_accounts')}
        description={tr('instagram_professional_accounts_and_facebook_pages_replyooo_replies_on')}
      >
        <Card className="divide-y divide-line">
          {accounts.map((account) => (
            <div key={account.id} className="flex flex-wrap items-center gap-3 p-4 sm:flex-nowrap">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar name={account.username} size={40} src={account.avatarUrl} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-semibold">@{account.username}</div>
                  <div className="flex items-center gap-1.5 text-[12.5px] text-subtle">
                    <PlatformIcon platform={account.platform} className="size-3 shrink-0" />
                    {account.platform === 'instagram' ? tr('instagram') : tr('facebook_page')}
                    {account.followers !== null && <>{tr('followers', { v0: formatCompact(account.followers) })}</>}
                  </div>
                </div>
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 pl-[52px] sm:w-auto sm:flex-nowrap sm:pl-0">
                {account.status === 'reauth_required' ? (
                  <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold whitespace-nowrap text-brand">
                    <TriangleAlert className="size-3.5" /> {tr('needs_reconnect')}{' '}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold whitespace-nowrap text-green">
                    <Check className="size-3.5" /> {tr('connected')}{' '}
                  </span>
                )}
                {account.status === 'reauth_required' && (
                  <ButtonLink href={`/connect?platform=${account.platform}`} size="sm">
                    {tr('reconnect')}
                  </ButtonLink>
                )}
                {manager && (
                  <ConfirmAction
                    action={disconnectAccount.bind(null, account.id)}
                    label={tr('disconnect')}
                    title={tr('disconnect_2', { v0: account.username })}
                    description={tr('automations_on_this_account_will_stop_replying_until_you_connect_it')}
                  />
                )}
              </div>
            </div>
          ))}
          <div className="p-4">
            <ButtonLink href="/connect" variant="secondary" size="sm">
              <Plus className="size-4" /> {tr('connect_account')}{' '}
            </ButtonLink>
          </div>
        </Card>
      </SettingsSection>

      <SettingsSection id="members" title={tr('members')} description={tr('people_who_can_edit_automations_and_see_contacts')}>
        <Card className="divide-y divide-line">
          {members.map((member) => (
            <div key={member.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
              <Avatar name={member.name} size={36} />
              <div className="min-w-0 flex-1 basis-40">
                <div className="text-[14px] font-semibold">
                  {member.name}
                  {member.userId === workspace.user.id && <span className="font-normal text-subtle">{tr('you')}</span>}
                </div>
                <div className="text-[12.5px] break-all text-subtle">{member.email}</div>
              </div>
              <span className="rounded-full bg-sand px-2.5 py-0.5 text-[12px] font-medium capitalize">{common(`role_${member.role}`)}</span>
              {manager && member.role !== 'owner' && member.userId !== workspace.user.id && (
                <ConfirmAction
                  action={removeMember.bind(null, member.id)}
                  label={tr('remove')}
                  title={tr('remove_2', { v0: member.name })}
                  description={tr('they_lose_access_to_this_workspace_s_automations_and_contacts_straight')}
                />
              )}
            </div>
          ))}
          {invitations.map((invitation) => (
            <div key={invitation.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
              <Avatar name={invitation.email} size={36} />
              <div className="min-w-0 flex-1 basis-40">
                <div className="text-[14px] font-semibold break-all">{invitation.email}</div>
                <div className="text-[12.5px] text-subtle">{tr('invited_joins_when_they_sign_up_or_log_in_with_this')}</div>
              </div>
              <span className="rounded-full bg-cream px-2.5 py-0.5 text-[12px] font-medium">{tr('pending')}</span>
              {manager && (
                <ConfirmAction
                  action={revokeInvitation.bind(null, invitation.id)}
                  label={tr('revoke')}
                  title={tr('revoke_the_invite_for', { v0: invitation.email })}
                  description={tr('the_invite_stops_working_you_can_send_a_new_one_later')}
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
                  placeholder={tr('teammate_example_com')}
                  className="h-9 flex-1 rounded-full border border-line px-4 text-[13.5px] outline-none focus:border-ink"
                />
                <button type="submit" className={buttonClass('dark', 'sm')}>
                  {tr('send_invite')}
                </button>
              </div>
              {notice && <p className="text-[12.5px] text-muted">{notice}</p>}
            </form>
          )}
        </Card>
      </SettingsSection>

      <SettingsSection id="billing" title={tr('billing')} description={tr('plans_are_metered_on_contacts_reached_per_month')}>
        {billingNotice && (
          <p role="status" className="mb-3 text-[13px] text-muted">
            {billingNotice}
          </p>
        )}
        {manager && subscription.billedPlan !== 'free' && PAYMENT_PROBLEMS.has(subscription.status) && (
          <Card className="mb-4 flex items-center gap-3 border-[#ffb59a] p-4 text-[13.5px]">
            <TriangleAlert className="size-4 shrink-0 text-brand" />
            {tr('paymentProblem', { plan: common(`plan_${subscription.billedPlan}`) })}
            {billingEnabled && subscription.hasBillingAccount && (
              <form action={openBillingPortal} className="ml-auto">
                <button type="submit" className={buttonClass('dark', 'sm')}>
                  {tr('update_payment')}
                </button>
              </form>
            )}
          </Card>
        )}
        <Card className="p-5">
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] font-semibold">{tr('this_month')}</span>
            <span className="text-[13px] text-subtle">
              {tr('contacts_reached', { v0: formatNumber(subscription.contactsReached), v1: formatNumber(subscription.contactsLimit) })}
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-sand">
            <div className="h-full rounded-full bg-ink" style={{ width: `${Math.min(100, usage * 100)}%` }} />
          </div>
          {subscription.renewsAt && subscription.plan !== 'free' && (
            <p className="mt-3 text-[12.5px] text-subtle">
              {tr('renews', {
                plan: common(`plan_${subscription.plan}`),
                interval: tr(subscription.billedInterval === 'year' ? 'yearly' : 'monthly'),
                date: formatDate(subscription.renewsAt, { month: 'long', day: 'numeric', year: 'numeric' }),
              })}
            </p>
          )}
        </Card>
        <BillingPlans
          cards={planCards(prices, locale).map((card) => {
            const limits = PLAN_LIMITS[card.key]
            return {
              ...card,
              name: common(`plan_${card.key}`),
              perks: [
                tr('contactsPerMonth', { count: formatNumber(limits.contactsPerMonth) }),
                tr('accountsLimit', { count: limits.connectedAccounts }),
                limits.liveAutomations === null ? tr('automationsUnlimited') : tr('automationsLimit', { count: limits.liveAutomations }),
                tr(`${card.key}Extra1`),
                tr(`${card.key}Extra2`),
              ],
            }
          })}
          yearly={prices.yearly}
          saveLabel={(() => {
            const percents = Object.values(prices.plans)
              .map((price) => price.savePercent)
              .filter((n): n is number => n !== null)
            if (!prices.yearly || !percents.length) return null
            const count = Math.max(...percents)
            return tr(percents.length === 2 && percents.every((n) => n === count) ? 'savings' : 'savingsUpTo', { count })
          })()}
          current={{ plan: subscription.plan, interval: subscription.billedInterval }}
          canAct={manager && billingEnabled}
          hasBillingAccount={subscription.hasBillingAccount}
          switchPlan={switchPlan}
          openBillingPortal={openBillingPortal}
        />
        {manager && billingEnabled && subscription.hasBillingAccount && (
          <form action={openBillingPortal} className="mt-4">
            <button type="submit" className="text-[13px] font-semibold text-ink hover:underline">
              {tr('manage_billing_and_invoices')}
            </button>
          </form>
        )}
        {!billingEnabled && <p className="mt-4 text-[12.5px] text-subtle">{tr('billing_isn_t_set_up_yet_plans_can_be_changed_once')}</p>}
        {billingEnabled && !manager && <p className="mt-4 text-[12.5px] text-subtle">{tr('only_owners_and_admins_can_change_the_plan')}</p>}
      </SettingsSection>

      {workspace.role === 'owner' && (
        <SettingsSection
          id="danger"
          title={tr('delete_workspace')}
          description={tr('deletes_every_automation_contact_and_message_and_disconnects_all_accounts_this')}
        >
          <Card className="border-[#ffb59a] p-5">
            <form action={deleteWorkspace} className="flex flex-wrap items-center gap-2">
              <input
                name="confirm"
                required
                placeholder={tr('type_to_confirm', { v0: workspace.workspaceName })}
                className="h-9 flex-1 rounded-full border border-line px-4 text-[13.5px] outline-none focus:border-ink"
              />
              <button type="submit" className="h-9 rounded-full bg-[#c2330e] px-4 text-[13px] font-semibold text-white hover:bg-[#a52a0a]">
                {tr('delete_workspace')}
              </button>
            </form>
          </Card>
        </SettingsSection>
      )}
    </div>
  )
}

function SettingsSection({ id, title, description, children }: { id: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-10 scroll-mt-8">
      <h2 className="text-[17px] font-semibold">{title}</h2>
      <p className="mt-0.5 mb-4 text-[13.5px] text-muted">{description}</p>
      {children}
    </section>
  )
}
