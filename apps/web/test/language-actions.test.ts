import { authUsers } from '@replyooo/db'
import { eq } from 'drizzle-orm'
import { beforeEach, expect, it, vi } from 'vitest'
import { setDashboardLanguage } from '@/app/language-actions'
import { getUserLocale } from '@/lib/data/preferences'
import { db } from '@/lib/db'
import { createUser } from './support'

const context = vi.hoisted(() => ({ user: null as { id: string } | null, savedCookie: '' }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => context.user,
  COOKIE_OPTIONS: { path: '/', httpOnly: true, sameSite: 'lax' },
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ set: (_name: string, value: string) => { context.savedCookie = value } }) }))
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`) } }))

beforeEach(() => { context.user = null; context.savedCookie = 'en' })

it('requires authentication before changing a language', async () => {
  await expect(setDashboardLanguage('es')).rejects.toThrow('redirect:/login')
})
it('rejects invalid locale and retains the previous preference', async () => {
  context.user = await createUser()
  expect(await setDashboardLanguage('ar')).toEqual({ ok: false, code: 'invalidLocale' })
  expect(await getUserLocale(context.user.id)).toBeNull()
  expect(context.savedCookie).toBe('en')
})
it('persists selection on the authenticated user and exposes it on subsequent requests', async () => {
  context.user = await createUser()
  expect(await setDashboardLanguage('es')).toEqual({ ok: true })
  expect(await getUserLocale(context.user.id)).toBe('es')
  expect(context.savedCookie).toBe('es')
})
it('keeps the previous cookie when the authenticated user was deleted before the write', async () => {
  context.user = await createUser()
  await db().delete(authUsers).where(eq(authUsers.id, context.user.id))
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    expect(await setDashboardLanguage('es')).toEqual({ ok: false, code: 'saveFailed' })
    expect(context.savedCookie).toBe('en')
  } finally { log.mockRestore() }
})
