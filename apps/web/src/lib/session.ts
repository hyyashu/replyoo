import 'server-only'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { auth } from './auth'
import { listAccounts } from './data'

export const ACCOUNT_COOKIE = 'replyooo_account'

/** The connected account the dashboard is scoped to (account switcher). */
export async function getCurrentAccount() {
  const accounts = await listAccounts()
  const selected = (await cookies()).get(ACCOUNT_COOKIE)?.value
  const account = accounts.find((a) => a.id === selected) ?? accounts[0]
  if (!account) redirect('/connect')
  return { account, accounts }
}

/** The Better Auth user for this request, or null. Cached per request. */
export const getSessionUser = cache(async () => {
  const requestHeaders = await headers() // first, so the page is dynamic before auth() reads env
  const session = await auth().api.getSession({ headers: requestHeaders })
  return session?.user ?? null
})
