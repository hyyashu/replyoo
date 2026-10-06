import 'server-only'
import { decryptToken, parseEncryptionKey } from '@replyooo/db'
import {
  type AccountCredentials,
  createFacebookAdapter,
  createInstagramAdapter,
  type PlatformAdapter,
} from '@replyooo/meta'
import type { Platform } from '@replyooo/shared'
import { env } from './env'

export function adapterFor(platform: Platform): PlatformAdapter {
  const options = { graphVersion: env().META_GRAPH_VERSION }
  return platform === 'instagram' ? createInstagramAdapter(options) : createFacebookAdapter(options)
}

export function tokenKey(): Buffer {
  return parseEncryptionKey(env().TOKEN_ENCRYPTION_KEY)
}

export function credentialsFor(account: { externalId: string; accessTokenEnc: string }): AccountCredentials {
  return { externalId: account.externalId, accessToken: decryptToken(account.accessTokenEnc, tokenKey()) }
}
