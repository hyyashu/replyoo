import type { Metadata } from 'next'
import { signInWithGoogle, signUp } from '@/app/auth-actions'
import { AuthForm } from '@/components/auth-form'
import { googleEnabled } from '@/lib/auth'

export const metadata: Metadata = { title: 'Sign up' }

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams
  return <AuthForm mode="signup" action={signUp} googleAction={googleEnabled() ? signInWithGoogle : undefined} email={email} />
}
