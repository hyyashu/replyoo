import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/site'

export default function robots(): MetadataRoute.Robots {
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
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
