import type { Metadata } from 'next'
import { signInWithGoogle, signUp } from '@/app/auth-actions'
import { AuthForm } from '@/components/auth-form'
import { googleEnabled } from '@/lib/auth'

export const metadata: Metadata = { title: 'Sign up' }

export default function SignupPage() {
  return <AuthForm mode="signup" action={signUp} googleAction={googleEnabled() ? signInWithGoogle : undefined} />
}
