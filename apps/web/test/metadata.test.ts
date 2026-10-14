import { describe, expect, it } from 'vitest'
import { pageMetadata } from '@/lib/metadata'

describe('pageMetadata', () => {
  it('sets the canonical URL and og:url together, and keeps the shared Open Graph image', () => {
    const metadata = pageMetadata({ title: 'Pricing', path: '/pricing' })
    expect(metadata.alternates).toEqual({ canonical: '/pricing' })
    expect(metadata.openGraph).toMatchObject({ url: '/pricing', siteName: 'Replyooo', type: 'website' })
    expect(metadata.openGraph?.images).toEqual([expect.objectContaining({ url: '/opengraph-image', width: 1200, height: 630 })])
  })
})
