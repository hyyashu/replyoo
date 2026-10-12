import { createTranslator } from 'next-intl'
import { expect, it } from 'vitest'
import { dashboardIssue } from '@/i18n/errors'
import es from '../messages/es.json'

it('maps known action failures to safe, translated messages', () => {
  const issue = dashboardIssue('This automation no longer exists')
  const t = createTranslator({ locale: 'es', messages: es, namespace: 'errors' })
  expect(t(issue.code as keyof typeof es.errors, issue.values)).toBe('Esta automatización ya no existe')
})
it('maps unknown external failures to a generic message without exposing technical details', () => {
  expect(dashboardIssue('SQL error with sensitive details')).toEqual({ code: 'generic' })
})
it('retains user-provided variable names as interpolation data', () => {
  expect(dashboardIssue("{{unknown}} isn't a variable we know, so it will be sent blank.")).toEqual({
    code: 'unknownVariable',
    values: { variable: '{{unknown}}' },
  })
})
