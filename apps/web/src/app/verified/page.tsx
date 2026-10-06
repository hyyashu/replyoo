import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Logo, buttonClass, cx } from '@/components/ui'

export const metadata: Metadata = { title: 'Confirm your email' }

/**
 * Landing page for the verification link. Better Auth redirects here on success (already signed in) and
 * with ?error=… when the link is expired or reused, so success never gets reported for a failed link.
 */
export default async function VerifiedPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  if (!error) redirect('/home?verified=1')
  return (
    <main className="mx-auto flex min-h-screen max-w-[420px] flex-col justify-center px-6">
      <Logo />
      <h1 className="mt-10 font-display text-[34px] leading-tight font-bold tracking-[-0.04em]">This link has expired</h1>
      <p className="mt-1.5 text-[15px] text-muted">
        We couldn’t confirm your email. Log in and use “Resend link” in the banner to get a new one.
      </p>
      <Link href="/home" className={cx(buttonClass('primary'), 'mt-8 h-11 w-full')}>
        Log in
      </Link>
    </main>
  )
}
