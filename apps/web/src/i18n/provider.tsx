import 'server-only'
import { getMessages, getNow } from 'next-intl/server'
import type { ReactNode } from 'react'
import { DashboardClientProvider } from './client-provider'
import { getDashboardLocale } from './request'

export async function DashboardProvider({ namespaces, children }: { namespaces: string[]; children: ReactNode }) {
  const [locale, messages, now] = await Promise.all([getDashboardLocale(), getMessages(), getNow()])
  const selected = Object.fromEntries(
    ['common', 'navigation', 'shared', 'errors', ...namespaces].filter((key) => Object.hasOwn(messages, key)).map((key) => [key, messages[key]!]),
  )
  return (
    <DashboardClientProvider locale={locale} messages={selected} now={now}>
      {children}
    </DashboardClientProvider>
  )
}
