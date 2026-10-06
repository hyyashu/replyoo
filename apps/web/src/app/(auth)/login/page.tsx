import type { Metadata } from 'next'
import { signIn, signInWithGoogle } from '@/app/auth-actions'
import { AuthForm } from '@/components/auth-form'
import { googleEnabled } from '@/lib/auth'

export const metadata: Metadata = { title: 'Log in' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  return <AuthForm mode="login" action={signIn} googleAction={googleEnabled() ? signInWithGoogle : undefined} next={next} />
}
