import { getPublicBioPage } from '@/lib/data'
import { bioImage, brandImage, ogSize } from '@/lib/og-image'

export const alt = 'Links page on Replyooo'
export const size = ogSize
export const contentType = 'image/png'

// Unlike the page, this never records a view.
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const found = await getPublicBioPage(slug.toLowerCase()).catch(() => null)
  return found ? bioImage(found.page.displayName, found.page.bio) : brandImage()
}
