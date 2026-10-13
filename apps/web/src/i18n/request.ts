import 'server-only'
import { cookies, headers } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import { cache } from 'react'
import { getSessionUser } from '@/lib/session'
import { getUserLocale } from '@/lib/data/preferences'
import { loadMessages } from './catalogs'
import { LOCALE_COOKIE, resolveLocale } from './locales'

export const getDashboardLocale = cache(async () => {
  const [jar, requestHeaders] = await Promise.all([cookies(), headers()])
  const user = await getSessionUser()
  const preferred = user ? await getUserLocale(user.id) : null
  return resolveLocale({ preferred, cookie: jar.get(LOCALE_COOKIE)?.value, acceptLanguage: requestHeaders.get('accept-language') ?? '' })
})

export default getRequestConfig(async () => {
  const locale = await getDashboardLocale()
  return { locale, messages: await loadMessages(locale), timeZone: 'UTC', now: new Date() }
})
