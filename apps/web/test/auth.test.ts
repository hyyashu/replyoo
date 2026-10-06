import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { authErrorMessage, createAuth } from '@/lib/auth'
import { db } from '@/lib/db'

const auth = createAuth({
  db: db(),
  secret: 'test-secret-test-secret-test-secret-0000',
  baseURL: 'http://localhost:3000',
})

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
