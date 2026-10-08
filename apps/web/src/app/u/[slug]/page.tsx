import type { Metadata } from 'next'
import { recordBioEvent } from '@replyooo/db'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { BioPageView } from '@/components/bio-page-view'
import { isBotUserAgent } from '@/lib/bio'
import { getPublicBioPage, toBioView } from '@/lib/data'
import { db } from '@/lib/db'

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
    openGraph: { title: page.displayName, description: page.bio || undefined, type: 'profile' },
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
  return <BioPageView page={{ ...toBioView(found.page, found.blocks), slug: found.page.slug }} />
}
