import type { MetadataRoute } from 'next'
import { ALTERNATIVES_PAGES } from '@/lib/content/alternatives'
import { COMPARE_PAGES } from '@/lib/content/compare'
import { SECTION_KEYS, SECTIONS, pagePath } from '@/lib/content/sections'
import { getSiteUrl } from '@/lib/site'

// `lastModified` is the date the page's content last really changed. Bump it by hand when you edit a page:
// Google ignores lastmod values that always equal "now", so don't generate it from the current date.
const pages = [
  { path: '/', lastModified: '2026-10-09', changeFrequency: 'weekly', priority: 1 },
  ...SECTION_KEYS.flatMap((section) =>
    SECTIONS[section].pages.map((page) => ({
      path: pagePath(section, page.slug),
      lastModified: page.updated,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
  ),
  ...COMPARE_PAGES.map((page) => ({ path: `/compare/${page.slug}`, lastModified: page.updated, changeFrequency: 'monthly' as const, priority: 0.7 })),
  ...ALTERNATIVES_PAGES.map((page) => ({ path: `/alternatives/${page.slug}`, lastModified: page.updated, changeFrequency: 'monthly' as const, priority: 0.7 })),
  { path: '/pricing', lastModified: '2026-10-09', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/signup', lastModified: '2026-10-06', changeFrequency: 'yearly', priority: 0.6 },
  { path: '/privacy', lastModified: '2026-10-06', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/terms', lastModified: '2026-10-06', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/data-deletion', lastModified: '2026-10-06', changeFrequency: 'yearly', priority: 0.3 },
] satisfies { path: string; lastModified: string; changeFrequency: 'weekly' | 'monthly' | 'yearly'; priority: number }[]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = await getSiteUrl()
  return pages.map(({ path, lastModified, changeFrequency, priority }) => ({
    url: `${siteUrl}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }))
}
