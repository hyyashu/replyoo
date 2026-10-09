import type { MetadataRoute } from 'next'
import { getSiteUrl } from '@/lib/site'

export default async function robots(): Promise<MetadataRoute.Robots> {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/home',
        '/automations',
        '/contacts',
        '/bio',
        '/settings',
        '/connect',
        '/verified',
        '/forgot-password',
        '/reset-password',
      ],
    },
    sitemap: `${await getSiteUrl()}/sitemap.xml`,
  }
}
