'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth, authErrorMessage } from '@/lib/auth'
import { safeNext } from '@/lib/redirects'

export type AuthState = { error: string } | null

const text = (formData: FormData, name: string) => String(formData.get(name) ?? '').trim()

export async function signIn(_state: AuthState, formData: FormData): Promise<AuthState> {
  try {
    await auth().api.signInEmail({
      body: { email: text(formData, 'email'), password: String(formData.get('password') ?? '') },
      headers: await headers(),
    })
  } catch (error) {
    const message = authErrorMessage(error)
    if (message) return { error: message }
    throw error
  }
  redirect(safeNext(formData.get('next'), '/home'))
}

export async function signUp(_state: AuthState, formData: FormData): Promise<AuthState> {
  const email = text(formData, 'email')
  try {
    await auth().api.signUpEmail({
      body: {
        name: text(formData, 'name') || email.split('@')[0] || 'there',
        email,
        password: String(formData.get('password') ?? ''),
      },
      headers: await headers(),
    })
  } catch (error) {
    const message = authErrorMessage(error)
    if (message) return { error: message }
    throw error
  }
  redirect('/connect')
}

export async function signInWithGoogle(formData: FormData) {
  const result = await auth().api.signInSocial({
    body: { provider: 'google', callbackURL: safeNext(formData.get('next'), '/home'), newUserCallbackURL: '/connect' },
    headers: await headers(),
  })
  if (!('url' in result) || !result.url) throw new Error('Google sign-in is not configured')
  redirect(result.url)
}

export async function signOut() {
  await auth().api.signOut({ headers: await headers() })
  redirect('/login')
}
