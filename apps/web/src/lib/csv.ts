const FORMULA_START = /^[=+\-@\t\r]/
/** `+91 98765 43210`: only digits and separators, so a spreadsheet can't run it. */
const PHONE = /^\+[\d\s().-]+$/

/** Quote every cell and neutralise spreadsheet formula injection without mangling phone numbers. */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) && !PHONE.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

export function toCsv(header: readonly string[], rows: string[][]): string {
  return [header.join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\r\n')
}

/** Header-safe `[A-Za-z0-9._-]` slug; anything else (quotes, non-Latin-1 text) becomes `-`. */
function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * Content-Disposition for a CSV download. `filename` is ASCII-only so the header can't throw
 * (Page names may hold characters above 0xFF) or be broken by a quote; `filename*` keeps the real name.
 */
export function csvContentDisposition(prefix: string, name: string, date: string): string {
  const safe = `${prefix}-${slug(name) || 'contacts'}-${date}.csv`
  const full = encodeURIComponent(`${prefix}-${name}-${date}.csv`).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${safe}"; filename*=UTF-8''${full}`
}
