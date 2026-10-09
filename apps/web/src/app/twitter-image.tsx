import { brandImage, ogSize } from '@/lib/og-image'

export const alt = 'Replyooo: turn every comment into a customer'
export const size = ogSize
export const contentType = 'image/png'

export default function Image() {
  return brandImage()
}
