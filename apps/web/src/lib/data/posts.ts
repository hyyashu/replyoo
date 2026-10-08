import 'server-only'
import { connectedAccounts } from '@replyooo/db'
import { MetaError } from '@replyooo/meta'
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { adapterFor, credentialsFor } from '../meta'
import { isUuid } from './ids'

export interface RecentPost {
  id: string
  caption: string | null
  thumbnailUrl: string | null
  permalink: string | null
  publishedAt: string | null
}

export type RecentPostsResult = { ok: true; posts: RecentPost[] } | { ok: false; error: string }

/** The account's latest posts and reels, fetched live from Meta so the picker shows what is actually published. */
export function listRecentPosts(workspaceId: string, accountId: string): Promise<RecentPostsResult> {
  return listRecent(workspaceId, accountId, 'posts')
}

/** The account's live stories (they disappear after 24 hours). Instagram only. */
export function listRecentStories(workspaceId: string, accountId: string): Promise<RecentPostsResult> {
  return listRecent(workspaceId, accountId, 'stories')
}

async function listRecent(workspaceId: string, accountId: string, source: 'posts' | 'stories'): Promise<RecentPostsResult> {
  if (!isUuid(accountId)) return { ok: false, error: 'Account not found' }
  const [account] = await db()
    .select()
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.workspaceId, workspaceId), eq(connectedAccounts.id, accountId)))
  if (!account || account.status === 'disconnected') return { ok: false, error: 'Account not found' }

  try {
    const adapter = adapterFor(account.platform)
    const creds = credentialsFor(account)
    const media = source === 'stories' ? await (adapter.listStories?.(creds) ?? Promise.resolve([])) : await adapter.listMedia(creds)
    return { ok: true, posts: media.map((m) => ({ ...m, publishedAt: m.publishedAt?.toISOString() ?? null })) }
  } catch (error) {
    if (!(error instanceof MetaError)) throw error
    if (error.kind === 'reauth') {
      return { ok: false, error: `Meta revoked access to @${account.username}. Reconnect it in Settings.` }
    }
    return { ok: false, error: `Couldn’t load your ${source === 'stories' ? 'stories' : 'posts'} from Meta: ${error.message}` }
  }
}
