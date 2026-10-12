'use client'

import { useEffect } from 'react'
import { useLocale } from 'next-intl'
import { isLocale, locales } from './locales'

export function DocumentLanguage() {
  const current = useLocale()
  const locale = isLocale(current) ? current : 'en'
  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = locales[locale].direction
    return () => {
      document.documentElement.lang = 'en'
      document.documentElement.dir = 'ltr'
    }
  }, [locale])
  return null
}
