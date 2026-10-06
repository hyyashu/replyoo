import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LEGAL } from '@/lib/legal'

const marketing = fileURLToPath(new URL('../src/app/(marketing)', import.meta.url))

describe('public pages', () => {
  it('has every page Meta App Review and the footer link to', () => {
    const pages = readdirSync(marketing, { recursive: true }).map(String).filter((p) => p.endsWith('page.tsx'))
    expect(pages.sort()).toEqual(
      ['data-deletion/page.tsx', 'data-deletion/status/page.tsx', 'page.tsx', 'pricing/page.tsx', 'privacy/page.tsx', 'terms/page.tsx'].sort(),
    )
  })

  it('names a contact address for privacy requests', () => {
    expect(LEGAL.contactEmail).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)
  })
})
