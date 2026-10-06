import type { Metadata } from 'next'
import Link from 'next/link'
import { ResetPasswordForm } from '@/components/password-forms'
import { buttonClass, cx } from '@/components/ui'

export const metadata: Metadata = { title: 'Choose a new password' }

/** Better Auth's /reset-password/:token redirects here with ?token=… or ?error=INVALID_TOKEN. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams
  if (token && !error) return <ResetPasswordForm token={token} />
  return (
    <>
      <h1 className="font-display text-[34px] leading-tight font-bold tracking-[-0.04em]">This link has expired</h1>
      <p className="mt-1.5 text-[15px] text-muted">Reset links work once, for one hour. Ask for a new one.</p>
      <Link href="/forgot-password" className={cx(buttonClass('primary'), 'mt-8 h-11 w-full')}>
        Send a new link
      </Link>
    </>
  )
}
