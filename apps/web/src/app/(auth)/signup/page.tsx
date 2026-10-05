import type { Metadata } from 'next'
import { signUp } from '@/app/actions'
import { AuthForm } from '@/components/auth-form'

export const metadata: Metadata = { title: 'Sign up' }

export default function SignupPage() {
  return <AuthForm mode="signup" action={signUp} />
}
