import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/site'

const pages = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/pricing', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/signup', changeFrequency: 'yearly', priority: 0.6 },
  { path: '/login', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/data-deletion', changeFrequency: 'yearly', priority: 0.3 },
] satisfies { path: string; changeFrequency: 'weekly' | 'monthly' | 'yearly'; priority: number }[]

export default function sitemap(): MetadataRoute.Sitemap {
  return pages.map(({ path, changeFrequency, priority }) => ({
    url: `${siteUrl}${path}`,
    changeFrequency,
    priority,
  }))
}
