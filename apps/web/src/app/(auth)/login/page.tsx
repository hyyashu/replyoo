import type { Metadata } from 'next'
import { signIn } from '@/app/actions'
import { AuthForm } from '@/components/auth-form'

export const metadata: Metadata = { title: 'Log in' }

export default function LoginPage() {
  return <AuthForm mode="login" action={signIn} />
}
