import { describe, expect, it } from 'vitest'
import { BEST_PAGES } from '@/lib/content/best'
import { getComparePage } from '@/lib/content/compare'

describe('best-of pages', () => {
  it('flag exactly one pick as ours, give every pick a weakness, and link only to real compare pages', () => {
    for (const page of BEST_PAGES) {
      expect(page.picks.filter((pick) => pick.us), page.slug).toHaveLength(1)
      expect(new Set(page.picks.map((pick) => pick.name)).size).toBe(page.picks.length)
      for (const pick of page.picks) {
        expect(pick.watchOut.length, pick.name).toBeGreaterThan(0)
        expect(pick.strengths.length, pick.name).toBeGreaterThan(0)
        if (pick.compareSlug) expect(getComparePage(pick.compareSlug), pick.compareSlug).toBeDefined()
      }
      expect(page.sources.length).toBeGreaterThan(0)
      expect(page.checked <= page.updated).toBe(true)
    }
  })
})
