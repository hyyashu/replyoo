import { brandImage, brandImageAlt, ogSize } from '@/lib/og-image'

export const alt = brandImageAlt
export const size = ogSize
export const contentType = 'image/png'

export default function Image() {
  return brandImage()
}
