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
