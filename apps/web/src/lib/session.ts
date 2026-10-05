import 'server-only'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
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
