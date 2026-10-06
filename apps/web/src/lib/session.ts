import 'server-only'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { auth } from './auth'
import { listAccounts } from './data/accounts'
import { db } from './db'
import { resolveWorkspace, type WorkspaceContext } from './workspaces'

export const ACCOUNT_COOKIE = 'replyooo_account'
export const WORKSPACE_COOKIE = 'replyooo_workspace'
export const COOKIE_OPTIONS = {
  path: '/',
  sameSite: 'lax',
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
} as const

/** The Better Auth user for this request, or null. Cached per request. */
export const getSessionUser = cache(async () => {
  const requestHeaders = await headers() // first, so the page is dynamic before auth() reads env
  const session = await auth().api.getSession({ headers: requestHeaders })
  return session?.user ?? null
})

/** Signed-in user + current workspace. Every page, action and route handler goes through this. */
export const requireWorkspace = cache(async (): Promise<WorkspaceContext> => {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const preferred = (await cookies()).get(WORKSPACE_COOKIE)?.value
  return resolveWorkspace(
    db(),
    { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified },
    preferred,
  )
})

/** The connected account the dashboard is scoped to (account switcher). */
export async function getCurrentAccount() {
  const workspace = await requireWorkspace()
  const accounts = await listAccounts(workspace.workspaceId)
  const selected = (await cookies()).get(ACCOUNT_COOKIE)?.value
  const account = accounts.find((a) => a.id === selected) ?? accounts[0]
  if (!account) redirect('/connect')
  return { workspace, account, accounts }
}
