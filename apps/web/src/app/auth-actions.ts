'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { auth, authErrorMessage } from '@/lib/auth'
import { appUrl } from '@/lib/env'
import { safeNext } from '@/lib/redirects'
import { COOKIE_OPTIONS, getSessionUser, VERIFY_COOLDOWN_COOKIE } from '@/lib/session'

export type AuthState = { error: string } | null
export type FormState = { error?: string; notice?: string } | null

/** Where Better Auth sends people after they click the verification link (autoSignInAfterVerification). */
const VERIFIED_CALLBACK = '/home?verified=1'

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
        callbackURL: VERIFIED_CALLBACK,
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

export async function requestPasswordReset(_state: FormState, formData: FormData): Promise<FormState> {
  const email = text(formData, 'email')
  if (!email) return { error: 'Enter your email address.' }
  try {
    await auth().api.requestPasswordReset({ body: { email, redirectTo: appUrl('/reset-password') }, headers: await headers() })
  } catch (error) {
    const message = authErrorMessage(error)
    if (message) return { error: message }
    throw error
  }
  // Same answer whether or not the address has an account.
  return { notice: 'If an account uses that address, we’ve emailed a link to reset the password. It works for one hour.' }
}

export async function resetPassword(_state: FormState, formData: FormData): Promise<FormState> {
  const password = String(formData.get('password') ?? '')
  if (password !== String(formData.get('confirm') ?? '')) return { error: 'The passwords don’t match.' }
  try {
    await auth().api.resetPassword({ body: { newPassword: password, token: text(formData, 'token') }, headers: await headers() })
  } catch (error) {
    const message = authErrorMessage(error)
    if (message) return { error: message }
    throw error
  }
  redirect('/login?reset=1')
}

export async function resendVerification(): Promise<void> {
  const user = await getSessionUser()
  if (!user || user.emailVerified) return
  const jar = await cookies()
  if (jar.has(VERIFY_COOLDOWN_COOKIE)) return
  await auth().api.sendVerificationEmail({ body: { email: user.email, callbackURL: VERIFIED_CALLBACK }, headers: await headers() })
  jar.set(VERIFY_COOLDOWN_COOKIE, '1', { ...COOKIE_OPTIONS, maxAge: 60 })
  revalidatePath('/', 'layout')
}
