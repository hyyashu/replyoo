import { expect, it } from 'vitest'
import { createDashboardFormatters } from '@/i18n/format'
import { formatMoney } from '@/lib/billing/pricing'

it('formats dates and relative time in Spanish with a consistent reference time', () => {
  const now = new Date('2026-10-13T12:00:00Z')
  const es = createDashboardFormatters('es', now)
  expect(es.formatDate('2026-10-13T00:00:00Z')).toContain('oct')
  expect(es.timeAgo('2026-10-13T10:00:00Z')).toBe('hace 2 h')
  expect(es.formatNumber(123456)).toBe(new Intl.NumberFormat('es').format(123456))
  expect(es.formatPercent(0.5)).toContain('50')
})

it('changes currency display locale without changing currency or minor-unit precision', () => {
  expect(formatMoney({ currency: 'USD', amount: 1250 }, 'es')).toContain('12,50')
  expect(formatMoney({ currency: 'USD', amount: 1250 }, 'es')).toContain('US$')
  expect(formatMoney({ currency: 'JPY', amount: 1250 }, 'es')).toContain('1250')
})
