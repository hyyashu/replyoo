import { Check, ShieldCheck } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { connectAccount } from '@/app/actions'
import { FacebookIcon, InstagramIcon } from '@/components/brand-icons'
import { Logo, cx } from '@/components/ui'
import { listAccounts } from '@/lib/data'

export const metadata: Metadata = { title: 'Connect an account' }

const OPTIONS = [
  {
    platform: 'instagram',
    title: 'Instagram',
    body: 'Professional (Business or Creator) account. No Facebook Page needed.',
    icon: InstagramIcon,
    tint: 'bg-[linear-gradient(135deg,#ffd7c4,#ffb59a)] text-[#a12b0b]',
    perks: ['Comments, stories & DMs', 'Follow gate', 'Conversation starters'],
  },
  {
    platform: 'facebook',
    title: 'Facebook Page',
    body: 'Pick one or more Pages you manage with Facebook Login for Business.',
    icon: FacebookIcon,
    tint: 'bg-sky-soft text-[#1f5f99]',
    perks: ['Comments & Messenger', 'Lead capture', 'Conversation starters'],
  },
] as const

export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ platform?: string }> }) {
  const [{ platform: highlight }, accounts] = await Promise.all([searchParams, listAccounts()])

  return (
    <div className="min-h-screen bg-sand">
      <header className="flex items-center justify-between px-8 py-6">
        <Link href={accounts.length ? '/home' : '/'}>
          <Logo />
        </Link>
        {accounts.length > 0 && (
          <Link href="/home" className="text-[13.5px] font-medium text-muted hover:text-ink">
            Skip for now
          </Link>
        )}
      </header>
      <main className="mx-auto max-w-[760px] px-6 pt-8 pb-20 text-center">
        <span className="eyebrow">Step 2 of 3</span>
        <h1 className="mt-3 font-display text-[40px] leading-tight font-bold tracking-[-0.04em]">Connect where your audience is</h1>
        <p className="mx-auto mt-2 max-w-md text-[15.5px] text-muted">
          Replyooo uses Meta’s official API. We never see your password, and you can disconnect any time.
        </p>

        <div className="mt-10 grid gap-4 text-left sm:grid-cols-2">
          {OPTIONS.map((option) => {
            const Icon = option.icon
            return (
              <form
                key={option.platform}
                action={connectAccount.bind(null, option.platform)}
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
                <button
                  type="submit"
                  className="mt-6 h-11 rounded-full bg-ink text-[14px] font-semibold text-white transition-colors hover:bg-ink-2"
                >
                  Continue with {option.platform === 'instagram' ? 'Instagram' : 'Facebook'}
                </button>
              </form>
            )
          })}
        </div>

        <p className="mt-8 inline-flex items-center gap-2 text-[13px] text-subtle">
          <ShieldCheck className="size-4" /> Tokens are encrypted at rest. Personal Instagram accounts need to switch to
          Professional first — it’s free and takes a minute.
        </p>
      </main>
    </div>
  )
}
