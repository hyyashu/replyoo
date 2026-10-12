'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { isLocale, LOCALE_COOKIE } from '@/i18n/locales'
import { saveUserLocale } from '@/lib/data/preferences'
import { COOKIE_OPTIONS, getSessionUser } from '@/lib/session'

export async function setDashboardLanguage(value: string): Promise<
  { ok: true } | { ok: false; code: 'invalidLocale' | 'saveFailed' }
> {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (!isLocale(value)) return { ok: false, code: 'invalidLocale' }
  try {
    await saveUserLocale(user.id, value)
  } catch (error) {
    console.error('Unable to save dashboard language', error)
    return { ok: false, code: 'saveFailed' }
  }
  ;(await cookies()).set(LOCALE_COOKIE, value, { ...COOKIE_OPTIONS, maxAge: 60 * 60 * 24 * 365 })
  return { ok: true }
}
