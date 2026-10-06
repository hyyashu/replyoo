import { describe, expect, it } from 'vitest'
import { csvCell, csvContentDisposition, toCsv } from '@/lib/csv'

describe('csvCell', () => {
  it('quotes values and escapes quotes', () => {
    expect(csvCell('Sam "the" Eater')).toBe('"Sam ""the"" Eater"')
  })

  it('neutralises formulas', () => {
    expect(csvCell('=HYPERLINK("https://evil.com")')).toBe(`"'=HYPERLINK(""https://evil.com"")"`)
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`)
    expect(csvCell('-2+3')).toBe(`"'-2+3"`)
    expect(csvCell('+1(555)HYPERLINK')).toBe(`"'+1(555)HYPERLINK"`)
  })

  it('leaves international phone numbers alone', () => {
    expect(csvCell('+91 98765 43210')).toBe('"+91 98765 43210"')
    expect(csvCell('+1 (555) 010-0199')).toBe('"+1 (555) 010-0199"')
  })
})

describe('toCsv', () => {
  it('joins rows with CRLF under an unquoted header', () => {
    expect(toCsv(['a', 'b'], [['1', '2']])).toBe('a,b\r\n"1","2"')
  })
})

describe('csvContentDisposition', () => {
  it('builds a header-safe filename', () => {
    expect(csvContentDisposition('contacts', 'replyooo', '2026-10-06')).toBe(
      `attachment; filename="contacts-replyooo-2026-10-06.csv"; filename*=UTF-8''contacts-replyooo-2026-10-06.csv`,
    )
  })

  it('survives non-Latin-1 names and quotes', () => {
    const header = csvContentDisposition('contacts', 'Café 東京', '2026-10-06')
    expect(() => new Headers({ 'Content-Disposition': header })).not.toThrow()
    expect(header).toContain('filename="contacts-Caf-2026-10-06.csv"')
    const quoted = csvContentDisposition('contacts', 'a"b; c', '2026-10-06')
    expect(quoted).toContain('filename="contacts-a-b-c-2026-10-06.csv"')
    expect(csvContentDisposition('contacts', '東京', '2026-10-06')).toContain('filename="contacts-contacts-2026-10-06.csv"')
  })
})
