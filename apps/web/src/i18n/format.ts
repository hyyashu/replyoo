import type { Locale } from './locales'

/** Fixed request time/timezone keep the server output and hydrated client consistent. */
export function createDashboardFormatters(locale: Locale | string, now = new Date()) {
  return {
    formatNumber: (n: number) => new Intl.NumberFormat(locale).format(n),
    formatCompact: (n: number) => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n),
    formatPercent: (n: number) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(n),
    formatDate: (iso: string, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) =>
      new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(new Date(iso)),
    timeAgo: (iso: string) => {
      const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000))
      const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
      for (const [size, unit] of [
        [86400, 'day'],
        [3600, 'hour'],
        [60, 'minute'],
      ] as const) {
        if (seconds >= size) return relative.format(-Math.floor(seconds / size), unit)
      }
      return relative.format(0, 'second')
    },
  }
}
