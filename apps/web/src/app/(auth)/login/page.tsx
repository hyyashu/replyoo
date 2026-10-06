import type { Metadata } from 'next'
import { signIn, signInWithGoogle } from '@/app/auth-actions'
import { AuthForm } from '@/components/auth-form'
import { googleEnabled } from '@/lib/auth'

export const metadata: Metadata = { title: 'Log in' }

const NOTICES: Record<string, string> = { '1': 'Password updated. Log in with your new password.' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const { next, reset } = await searchParams
  return (
    <AuthForm
      mode="login"
      action={signIn}
      googleAction={googleEnabled() ? signInWithGoogle : undefined}
      next={next}
      notice={reset ? NOTICES[reset] : undefined}
    />
  )
}
