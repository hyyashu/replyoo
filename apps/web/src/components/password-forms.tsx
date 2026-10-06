'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { type FormState, requestPasswordReset, resetPassword } from '@/app/auth-actions'
import { authField } from './auth-form'
import { buttonClass, cx } from './ui'

function Message({ state }: { state: FormState }) {
  if (state?.error) {
    return (
      <p role="alert" className="text-[13px] font-medium text-[#c2330e]">
        {state.error}
      </p>
    )
  }
  if (state?.notice) {
    return (
      <p role="status" className="rounded-xl bg-white px-3.5 py-2.5 text-[13.5px] text-ink">
        {state.notice}
      </p>
    )
  }
  return null
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, null)
  return (
    <>
      <h1 className="font-display text-[34px] leading-tight font-bold tracking-[-0.04em]">Reset your password</h1>
      <p className="mt-1.5 text-[15px] text-muted">We’ll email you a link to choose a new one.</p>
      <form action={action} className="mt-8 flex flex-col gap-3">
        <input name="email" type="email" required placeholder="you@example.com" autoComplete="email" className={authField} />
        <Message state={state} />
        <button type="submit" disabled={pending} className={cx(buttonClass('primary'), 'mt-2 h-11 w-full', pending && 'opacity-60')}>
          Email me a link
        </button>
      </form>
      <p className="mt-6 text-center text-[13.5px] text-muted">
        Remembered it?{' '}
        <Link href="/login" className="font-semibold text-ink underline-offset-2 hover:underline">
          Log in
        </Link>
      </p>
    </>
  )
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPassword, null)
  return (
    <>
      <h1 className="font-display text-[34px] leading-tight font-bold tracking-[-0.04em]">Choose a new password</h1>
      <p className="mt-1.5 text-[15px] text-muted">You’ll be signed out everywhere else.</p>
      <form action={action} className="mt-8 flex flex-col gap-3">
        <input type="hidden" name="token" value={token} />
        <input name="password" type="password" required minLength={8} placeholder="New password" autoComplete="new-password" className={authField} />
        <input name="confirm" type="password" required minLength={8} placeholder="Repeat it" autoComplete="new-password" className={authField} />
        <Message state={state} />
        <button type="submit" disabled={pending} className={cx(buttonClass('primary'), 'mt-2 h-11 w-full', pending && 'opacity-60')}>
          Save password
        </button>
      </form>
    </>
  )
}
