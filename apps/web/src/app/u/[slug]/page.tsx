import type { Metadata } from 'next'
import { recordBioEvent } from '@replyooo/db'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { BioPageView } from '@/components/bio-page-view'
import { JsonLd } from '@/components/json-ld'
import { isBotUserAgent, isSafeHttpUrl } from '@/lib/bio'
import { getPublicBioPage, toBioView } from '@/lib/data'
import { db } from '@/lib/db'
import { getSiteUrl } from '@/lib/site'
import { single } from '@/lib/structured-data'

// Public and always fresh; edits also call revalidatePath.
export const dynamic = 'force-dynamic'

const load = cache(async (slug: string) => getPublicBioPage(slug.toLowerCase()))

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const found = await load(slug)
  if (!found) return { title: 'Page not found' }
  const { page } = found
  return {
    title: { absolute: `${page.displayName} | Links` },
    description: page.bio || `Links from ${page.displayName}`,
    alternates: { canonical: `/u/${page.slug}` },
    openGraph: { title: page.displayName, description: page.bio || undefined, siteName: 'Replyooo', type: 'profile' },
  }
}

export default async function PublicBioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const found = await load(slug)
  if (!found) notFound()
  const requestHeaders = await headers()
  const prefetch = (requestHeaders.get('purpose') ?? requestHeaders.get('sec-purpose') ?? '').includes('prefetch')
  if (!prefetch && !isBotUserAgent(requestHeaders.get('user-agent'))) {
    await recordBioEvent(db(), { pageId: found.page.id, type: 'view' }).catch(() => {})
  }
  const { page } = found
  const url = `${await getSiteUrl()}/u/${page.slug}`
  // Only what the page already shows publicly.
  const person = {
    '@type': 'Person',
    name: page.displayName,
    url,
    ...(page.bio && { description: page.bio }),
    ...(page.avatarUrl && isSafeHttpUrl(page.avatarUrl) && { image: page.avatarUrl }),
  }
  return (
    <>
      <JsonLd data={single({ '@type': 'ProfilePage', url, mainEntity: person })} />
      <BioPageView page={{ ...toBioView(page, found.blocks), slug: page.slug }} />
    </>
  )
}
