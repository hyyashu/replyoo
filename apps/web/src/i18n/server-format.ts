import 'server-only'
import { getLocale, getNow } from 'next-intl/server'
import { createDashboardFormatters } from './format'

export async function getDashboardFormatters() {
  const [locale, now] = await Promise.all([getLocale(), getNow()])
  return createDashboardFormatters(locale, now)
}
