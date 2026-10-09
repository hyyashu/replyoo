import { AUDIENCE_PAGES } from '@/lib/content/audiences'
import { FEATURE_PAGES } from '@/lib/content/features'
import type { MarketingPage } from '@/lib/content/types'
import { USE_CASE_PAGES } from '@/lib/content/use-cases'

export type SectionKey = 'features' | 'use-cases' | 'for'

/** The /features, /use-cases and /for pages, which share one template. Compare and alternatives pages have their own. */
export const SECTIONS: Record<SectionKey, { label: string; pages: MarketingPage[] }> = {
  features: { label: 'Features', pages: FEATURE_PAGES },
  'use-cases': { label: 'Use cases', pages: USE_CASE_PAGES },
  for: { label: 'Who it’s for', pages: AUDIENCE_PAGES },
}

export const SECTION_KEYS = Object.keys(SECTIONS) as SectionKey[]

export const getPage = (section: SectionKey, slug: string) => SECTIONS[section].pages.find((page) => page.slug === slug)
export const pagePath = (section: SectionKey, slug: string) => `/${section}/${slug}`
