import type { Metadata } from 'next'
import { brandImageAlt, ogSize } from '@/lib/og-image'

/**
 * Open Graph fields every page shares. A page that sets `openGraph` replaces the layout's whole object, including the
 * image from `app/opengraph-image.tsx`, so pages spread these in rather than relying on inheritance.
 */
export const BASE_OPEN_GRAPH = {
  siteName: 'Replyooo',
  type: 'website',
  locale: 'en_US',
  images: [{ url: '/opengraph-image', alt: brandImageAlt, type: 'image/png', ...ogSize }],
} satisfies NonNullable<Metadata['openGraph']>

/** Metadata for a public page: its canonical URL and the matching og:url, resolved against the layout's `metadataBase`. */
export function pageMetadata({ title, description, path }: { title: string; description?: string; path: string }): Metadata {
  return { title, description, alternates: { canonical: path }, openGraph: { ...BASE_OPEN_GRAPH, url: path } }
}
