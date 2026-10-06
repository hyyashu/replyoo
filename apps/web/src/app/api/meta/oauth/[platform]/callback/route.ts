import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { type ConnectError, OAUTH_COOKIE, completeConnect, isPlatform, stateMatches } from '@/lib/connect'
import { db } from '@/lib/db'
import { ACCOUNT_COOKIE, COOKIE_OPTIONS, requireWorkspace } from '@/lib/session'

export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params
  if (!isPlatform(platform)) return new Response('Not found', { status: 404 })
  const workspace = await requireWorkspace()
  const url = new URL(request.url)
  const jar = await cookies()
  const expected = jar.get(OAUTH_COOKIE)?.value
  jar.delete(OAUTH_COOKIE)

  const fail = (error: ConnectError) => redirect(`/connect?platform=${platform}&error=${error}`)
  if (!stateMatches(expected, platform, url.searchParams.get('state'))) return fail('state_mismatch')
  const code = url.searchParams.get('code')
  if (!code) return fail('cancelled')

  const result = await completeConnect(db(), platform, workspace.workspaceId, workspace.user.id, code)
  if (!result.ok) return fail(result.error)
  const [first] = result.accountIds
  if (first) jar.set(ACCOUNT_COOKIE, first, COOKIE_OPTIONS)
  redirect('/automations/new')
}
