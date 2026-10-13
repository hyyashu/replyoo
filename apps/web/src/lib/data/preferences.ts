import 'server-only'
import { authUsers } from '@replyooo/db'
import { eq } from 'drizzle-orm'
import { isLocale, type Locale } from '@/i18n/locales'
import { db } from '../db'

export async function getUserLocale(userId: string): Promise<string | null> {
  const [user] = await db().select({ locale: authUsers.locale }).from(authUsers).where(eq(authUsers.id, userId))
  return user?.locale ?? null
}

export async function saveUserLocale(userId: string, locale: Locale): Promise<void> {
  if (!isLocale(locale)) throw new Error('Unsupported locale')
  const rows = await db().update(authUsers).set({ locale }).where(eq(authUsers.id, userId)).returning({ id: authUsers.id })
  if (!rows.length) throw new Error('User no longer exists')
}
