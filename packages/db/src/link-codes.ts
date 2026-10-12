import { randomBytes } from 'node:crypto'

export const LINK_CODE_LENGTH = 8
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const LINK_CODE_PATTERN = new RegExp(`^[0-9A-Za-z]{${LINK_CODE_LENGTH}}$`)

/** True for exactly the strings `generateLinkCode` can produce. Check this before touching the database. */
export function isLinkCode(value: string): boolean {
  return LINK_CODE_PATTERN.test(value)
}

/** A random 8-character base62 code. Bytes >= 248 are skipped so every character is equally likely. */
export function generateLinkCode(): string {
  let code = ''
  while (code.length < LINK_CODE_LENGTH) {
    for (const byte of randomBytes(16)) {
      if (byte >= 248) continue
      code += ALPHABET[byte % ALPHABET.length]
      if (code.length === LINK_CODE_LENGTH) break
    }
  }
  return code
}
