import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { OAUTH_COOKIE, authorizeUrl, isPlatform } from '@/lib/connect'
import { COOKIE_OPTIONS, requireWorkspace } from '@/lib/session'

export async function GET(_request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params
  if (!isPlatform(platform)) return new Response('Not found', { status: 404 })
  await requireWorkspace()

  const state = randomUUID()
  ;(await cookies()).set(OAUTH_COOKIE, `${platform}:${state}`, { ...COOKIE_OPTIONS, maxAge: 600 })
  redirect(authorizeUrl(platform, state))
}
