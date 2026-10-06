'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import type { AuthState } from '@/app/auth-actions'
import { buttonClass, cx } from './ui'

export const authField =
  'h-11 w-full rounded-xl border border-line bg-white px-3.5 text-[14px] outline-none transition-colors placeholder:text-faint focus:border-ink'

export function AuthForm({
  mode,
  action,
  googleAction,
  next,
  notice,
  email,
}: {
  mode: 'login' | 'signup'
  action: (state: AuthState, formData: FormData) => Promise<AuthState>
  googleAction?: (formData: FormData) => Promise<void>
  next?: string
  notice?: string
  email?: string
}) {
  const signup = mode === 'signup'
  const [state, formAction, pending] = useActionState(action, null)

  return (
    <>
      <h1 className="font-display text-[34px] leading-tight font-bold tracking-[-0.04em]">
        {signup ? 'Start free' : 'Welcome back'}
      </h1>
      <p className="mt-1.5 text-[15px] text-muted">
        {signup ? '1,000 contacts a month free. No card needed.' : 'Log in to your Replyooo workspace.'}
      </p>
      {notice && (
        <p role="status" className="mt-4 rounded-xl bg-white px-3.5 py-2.5 text-[13.5px] text-ink">
          {notice}
        </p>
      )}

      {googleAction && (
        <>
          <form action={googleAction} className="mt-8">
            {next && <input type="hidden" name="next" value={next} />}
            <button type="submit" className={cx(buttonClass('secondary'), 'h-11 w-full')}>
              <GoogleIcon /> Continue with Google
            </button>
          </form>
          <div className="my-4 flex items-center gap-3 text-[12px] text-subtle">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      <form action={formAction} className={cx('flex flex-col gap-3', !googleAction && 'mt-8')}>
        {next && <input type="hidden" name="next" value={next} />}
        {signup && <input name="name" placeholder="Your name" autoComplete="name" className={authField} />}
        <input name="email" type="email" required defaultValue={email} placeholder="you@example.com" autoComplete="email" className={authField} />
        <input
          name="password"
          type="password"
          required
          minLength={8}
          placeholder="Password"
          autoComplete={signup ? 'new-password' : 'current-password'}
          className={authField}
        />
        {!signup && (
          <Link href="/forgot-password" className="-mt-1 self-end text-[12.5px] font-medium text-muted hover:text-ink">
            Forgot password?
          </Link>
        )}
        {state?.error && (
          <p role="alert" className="text-[13px] font-medium text-[#c2330e]">
            {state.error}
          </p>
        )}
        <button type="submit" disabled={pending} className={cx(buttonClass('primary'), 'mt-2 h-11 w-full', pending && 'opacity-60')}>
          {signup ? 'Create account' : 'Log in'}
        </button>
      </form>
      <p className="mt-6 text-center text-[13.5px] text-muted">
        {signup ? 'Already have an account? ' : 'New to Replyooo? '}
        <Link href={signup ? '/login' : '/signup'} className="font-semibold text-ink underline-offset-2 hover:underline">
          {signup ? 'Log in' : 'Create one'}
        </Link>
      </p>
      {signup && (
        <p className="mt-4 text-center text-[12px] text-subtle">
          By signing up you agree to our <Link href="/terms" className="underline">Terms</Link> and{' '}
          <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </p>
      )}
    </>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z" />
    </svg>
  )
}
