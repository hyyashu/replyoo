'use client'

import { useLocale, useNow } from 'next-intl'
import { createDashboardFormatters } from './format'

export function useDashboardFormatters() {
  return createDashboardFormatters(useLocale(), useNow({ updateInterval: 60000 }))
}
