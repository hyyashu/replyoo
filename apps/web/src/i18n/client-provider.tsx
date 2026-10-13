'use client'

import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'
import type { ReactNode } from 'react'
import type { Locale } from './locales'

export function DashboardClientProvider({
  locale,
  messages,
  now,
  children,
}: {
  locale: Locale
  messages: AbstractIntlMessages
  now: Date
  children: ReactNode
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC" now={now}>
      {children}
    </NextIntlClientProvider>
  )
}
