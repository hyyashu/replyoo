import type { Platform } from '@replyooo/shared'

export type DmPlatform = Platform

/** Strips what people paste around a handle: spaces, a leading @, or a full profile URL. */
export function cleanHandle(input: string): string {
  let handle = input.trim()
  const url = handle.match(/^(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|facebook\.com|fb\.com|ig\.me\/m|m\.me)\/([^/?#]+)/i)
  if (url) handle = url[1]!
  return handle.replace(/^@/, '').replace(/\/+$/, '')
}

// Instagram usernames: up to 30 letters, numbers, periods and underscores. Facebook Page usernames: at least 5 letters,
// numbers and periods. We only check the characters, not that the account exists.
const VALID: Record<DmPlatform, RegExp> = {
  instagram: /^[a-z0-9._]{1,30}$/i,
  facebook: /^[a-z0-9.]{5,50}$/i,
}

export function isValidHandle(platform: DmPlatform, handle: string): boolean {
  return VALID[platform].test(handle)
}

/** The link that opens a DM with the account: ig.me/m/<username> or m.me/<page>. Null when the handle can't be valid. */
export function dmLink(platform: DmPlatform, input: string): string | null {
  const handle = cleanHandle(input)
  if (!isValidHandle(platform, handle)) return null
  return platform === 'instagram' ? `https://ig.me/m/${handle}` : `https://m.me/${handle}`
}
