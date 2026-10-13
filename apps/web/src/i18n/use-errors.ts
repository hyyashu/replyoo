'use client'

import { useTranslations } from 'next-intl'
import { dashboardIssue } from './errors'

export function useDashboardError() {
  const t = useTranslations('errors')
  return (message: string | undefined) => {
    const issue = dashboardIssue(message ?? '')
    return t(issue.code, issue.values)
  }
}
