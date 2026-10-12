import { getTranslations } from 'next-intl/server'
import { Check, ShieldCheck } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { FacebookIcon, InstagramIcon } from '@/components/brand-icons'
import { Logo, cx } from '@/components/ui'
import { LanguageSelector } from '@/components/language-selector'
import { signOut } from '@/app/auth-actions'
import { WorkspaceList } from '@/components/workspace-list'
import { listAccounts } from '@/lib/data'
import { db } from '@/lib/db'
import { requireWorkspace } from '@/lib/session'
import { listWorkspaces } from '@/lib/workspaces'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('connect'))('pageTitle') }
}

export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ platform?: string; error?: string }> }) {
  const tr = await getTranslations('connect')
  const ERRORS: Record<string, string> = {
    cancelled: tr('connection_was_cancelled_try_again_when_you_re_ready'),
    state_mismatch: tr('that_sign_in_link_expired_start_again_from_this_page'),
    personal_account: tr('that_instagram_account_is_personal_switch_it_to_a_professional_business'),
    owned_elsewhere: tr('that_account_is_already_connected_to_another_replyooo_workspace'),
    no_pages: tr('we_didn_t_get_access_to_any_facebook_pages_try_again'),
    plan_limit: tr('your_plan_s_connected_account_limit_is_reached_disconnect_an_account'),
    meta_error: tr('meta_didn_t_accept_the_connection_try_again_in_a_minute'),
  }
  const OPTIONS = [
    {
      platform: 'instagram',
      title: tr('instagram'),
      body: tr('professional_business_or_creator_account_no_facebook_page_needed'),
      icon: InstagramIcon,
      tint: 'bg-[linear-gradient(135deg,#ffd7c4,#ffb59a)] text-[#a12b0b]',
      perks: [tr('comments_stories_dms'), tr('follow_gate'), tr('conversation_starters')],
    },
    {
      platform: 'facebook',
      title: tr('facebook_page'),
      body: tr('pick_one_or_more_pages_you_manage_with_facebook_login_for'),
      icon: FacebookIcon,
      tint: 'bg-sky-soft text-[#1f5f99]',
      perks: [tr('comments_messenger'), tr('lead_capture'), tr('conversation_starters')],
    },
  ] as const
  const { workspaceId, user } = await requireWorkspace()
  const [{ platform: highlight, error }, accounts, workspaces] = await Promise.all([
    searchParams,
    listAccounts(workspaceId),
    listWorkspaces(db(), user.id),
  ])

  return (
    <div className="min-h-screen bg-sand">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8 sm:py-6">
        <Link href={accounts.length ? '/home' : '/'}>
          <Logo />
        </Link>
        <div className="flex flex-wrap items-center gap-3 text-[13.5px] font-medium text-muted">
          <LanguageSelector compact />
          {accounts.length > 0 && (
            <Link href="/home" className="hover:text-ink">
              {tr('skip_for_now')}
            </Link>
          )}
          <Link href="/settings" className="hover:text-ink">
            {tr('settings')}
          </Link>
          <form action={signOut}>
            <button type="submit" className="font-medium hover:text-ink">
              {tr('log_out')}
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-[760px] px-6 pt-8 pb-20 text-center">
        <span className="eyebrow">{tr('step_2_of_3')}</span>
        <h1 className="mt-3 font-display text-[40px] leading-tight font-bold tracking-[-0.04em]">{tr('connect_where_your_audience_is')}</h1>
        <p className="mx-auto mt-2 max-w-md text-[15.5px] text-muted">{tr('replyooo_uses_meta_s_official_api_we_never_see_your_password')}</p>
        {error && ERRORS[error] && (
          <p role="alert" className="mx-auto mt-6 max-w-md rounded-2xl border border-[#ffd7c4] bg-brand-tint px-4 py-3 text-[13.5px] text-ink">
            {ERRORS[error]}
          </p>
        )}

        <div className="mt-10 grid gap-4 text-left sm:grid-cols-2">
          {OPTIONS.map((option) => {
            const Icon = option.icon
            return (
              <div
                key={option.platform}
                className={cx(
                  'flex flex-col rounded-[22px] border bg-white p-6',
                  highlight === option.platform ? 'border-ink ring-1 ring-ink' : 'border-line',
                )}
              >
                <span className={cx('grid size-12 place-items-center rounded-2xl', option.tint)}>
                  <Icon className="size-6" />
                </span>
                <h2 className="mt-5 text-[18px] font-semibold">{option.title}</h2>
                <p className="mt-1 text-[13.5px] leading-snug text-muted">{option.body}</p>
                <ul className="mt-4 flex flex-col gap-1.5 text-[13px]">
                  {option.perks.map((perk) => (
                    <li key={perk} className="flex items-center gap-2">
                      <Check className="size-3.5 text-green" /> {perk}
                    </li>
                  ))}
                </ul>
                <a
                  href={`/api/meta/oauth/${option.platform}/start`}
                  className="mt-6 grid h-11 place-items-center rounded-full bg-ink text-[14px] font-semibold text-white transition-colors hover:bg-ink-2"
                >
                  {tr('continue_with')} {option.platform === 'instagram' ? tr('instagram') : tr('facebook')}
                </a>
              </div>
            )
          })}
        </div>

        {workspaces.length > 1 && (
          <section className="mx-auto mt-12 max-w-md">
            <h2 className="text-[15px] font-semibold">{tr('switch_workspace')}</h2>
            <p className="mt-0.5 mb-3 text-[13px] text-muted">{tr('looking_for_your_other_accounts_they_live_in_another_workspace')}</p>
            <WorkspaceList workspaces={workspaces} currentId={workspaceId} />
          </section>
        )}

        <p className="mt-8 inline-flex items-center gap-2 text-[13px] text-subtle">
          <ShieldCheck className="size-4" /> {tr('tokens_are_encrypted_at_rest_personal_instagram_accounts_need_to_switch')}{' '}
        </p>
      </main>
    </div>
  )
}
