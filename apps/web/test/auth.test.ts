import { authUsers } from '@replyooo/db'
import { RecordingMailer } from '@replyooo/email/testing'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authErrorMessage, createAuth } from '@/lib/auth'
import { db } from '@/lib/db'

const mailer = new RecordingMailer()
beforeEach(() => mailer.clear())

const auth = createAuth({
  db: db(),
  secret: 'test-secret-test-secret-test-secret-0000',
  baseURL: 'http://localhost:3000',
  mailer,
})

function linkIn(text: string): string {
  const match = text.match(/https?:\/\/\S+/)
  if (!match) throw new Error(`no link in: ${text}`)
  return match[0]
}

async function emailVerified(address: string) {
  const [user] = await db().select({ emailVerified: authUsers.emailVerified }).from(authUsers).where(eq(authUsers.email, address))
  return user?.emailVerified
}

const email = () => `person-${randomUUID()}@example.com`

function sessionCookie(headers: Headers): string {
  const cookie = headers.getSetCookie().find((c) => c.startsWith('better-auth.session_token='))
  if (!cookie) throw new Error('no session cookie was set')
  return cookie.split(';')[0] ?? ''
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the call to throw')
}

describe('email and password auth', () => {
  it('signs up and reads the session back from the cookie it set', async () => {
    const address = email()
    const { headers } = await auth.api.signUpEmail({
      body: { name: 'New Person', email: address, password: 'correct-horse' },
      returnHeaders: true,
    })
    const session = await auth.api.getSession({ headers: new Headers({ cookie: sessionCookie(headers) }) })
    expect(session?.user).toMatchObject({ email: address, name: 'New Person', emailVerified: false })
  })

  it('refuses a second account with the same email', async () => {
    const address = email()
    await auth.api.signUpEmail({ body: { name: 'One', email: address, password: 'correct-horse' } })
    const error = await caught(auth.api.signUpEmail({ body: { name: 'Two', email: address, password: 'correct-horse' } }))
    expect(authErrorMessage(error)).toBe('An account with this email already exists. Log in instead.')
  })

  it('rejects a wrong password with a friendly message', async () => {
    const address = email()
    await auth.api.signUpEmail({ body: { name: 'Three', email: address, password: 'correct-horse' } })
    const error = await caught(auth.api.signInEmail({ body: { email: address, password: 'wrong-horse' } }))
    expect(authErrorMessage(error)).toBe('Wrong email or password.')
  })

  it('rejects short passwords', async () => {
    const error = await caught(auth.api.signUpEmail({ body: { name: 'Four', email: email(), password: 'short' } }))
    expect(authErrorMessage(error)).toBe('Use at least 8 characters for your password.')
  })

  it('does not treat unrelated errors as auth errors', () => {
    expect(authErrorMessage(new Error('boom'))).toBeNull()
  })
})

describe('email verification', () => {
  it('emails a link on sign-up that verifies the address and signs the person in', async () => {
    const address = email()
    await auth.api.signUpEmail({
      body: { name: 'Verify Me', email: address, password: 'correct-horse', callbackURL: '/home?verified=1' },
    })
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]).toMatchObject({ to: address, subject: 'Confirm your email for Replyooo' })
    expect(await emailVerified(address)).toBe(false)

    const response = await auth.handler(new Request(linkIn(mailer.sent[0]?.text ?? '')))
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('/home?verified=1')
    expect(response.headers.getSetCookie().some((c) => c.startsWith('better-auth.session_token='))).toBe(true)
    expect(await emailVerified(address)).toBe(true)
  })

  it('still signs up when the email provider is down', async () => {
    const failing = new RecordingMailer()
    failing.failWith = new Error('provider down')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const flaky = createAuth({ db: db(), secret: 'test-secret-test-secret-test-secret-0000', baseURL: 'http://localhost:3000', mailer: failing })

    await expect(flaky.api.signUpEmail({ body: { name: 'Down', email: email(), password: 'correct-horse' } })).resolves.toBeTruthy()
    await vi.waitFor(() =>
      expect(errors).toHaveBeenCalledWith('email delivery failed', expect.objectContaining({ subject: 'Confirm your email for Replyooo' })),
    )
    errors.mockRestore()
  })
})

describe('password reset', () => {
  it('emails a reset link whose token sets a new password', async () => {
    const address = email()
    await auth.api.signUpEmail({ body: { name: 'Forgetful', email: address, password: 'correct-horse' } })
    mailer.clear()

    await auth.api.requestPasswordReset({ body: { email: address, redirectTo: 'http://localhost:3000/reset-password' } })
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]).toMatchObject({ to: address, subject: 'Reset your Replyooo password' })
    const token = new URL(linkIn(mailer.sent[0]?.text ?? '')).pathname.split('/').at(-1) ?? ''

    await auth.api.resetPassword({ body: { newPassword: 'battery-staple', token } })
    await expect(auth.api.signInEmail({ body: { email: address, password: 'battery-staple' } })).resolves.toBeTruthy()
    const error = await caught(auth.api.signInEmail({ body: { email: address, password: 'correct-horse' } }))
    expect(authErrorMessage(error)).toBe('Wrong email or password.')
  })

  it('answers the same for an unknown address and sends nothing', async () => {
    await expect(
      auth.api.requestPasswordReset({ body: { email: email(), redirectTo: 'http://localhost:3000/reset-password' } }),
    ).resolves.toBeTruthy()
    expect(mailer.sent).toEqual([])
  })

  it('explains an expired or reused token', async () => {
    const error = await caught(auth.api.resetPassword({ body: { newPassword: 'battery-staple', token: 'not-a-token' } }))
    expect(authErrorMessage(error)).toBe('That reset link has expired. Request a new one.')
  })
})
