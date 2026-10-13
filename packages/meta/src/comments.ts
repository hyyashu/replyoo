import type { Trigger } from '@replyooo/shared'
import type { AccountCredentials, CommentItem, PlatformAdapter } from './types'

/** A safety net on paging; 20 pages of 50 is already twice the per-run comment cap. */
const MAX_PAGES = 20

/**
 * Reads a post's comments made at or after `since`, up to `max`. Instagram lists newest first and cannot filter
 * by time, so paging stops at the first non-empty page with nothing in the window. Facebook may rank the results,
 * so it is given `since` as well, and a page that still has in-window comments never ends the read.
 */
export async function collectComments(
  adapter: Pick<PlatformAdapter, 'listComments'>,
  account: AccountCredentials,
  mediaId: string,
  opts: { since: Date; max: number },
): Promise<{ items: CommentItem[]; capped: boolean }> {
  const items: CommentItem[] = []
  let cursor: string | undefined
  for (let pages = 0; pages < MAX_PAGES; pages++) {
    const page = await adapter.listComments(account, mediaId, { since: opts.since, ...(cursor ? { cursor } : {}) })
    const inWindow = page.items.filter((c) => c.createdAt.getTime() >= opts.since.getTime())
    for (const comment of inWindow) {
      if (items.length >= opts.max) return { items, capped: true }
      items.push(comment)
    }
    if (!page.next || (page.items.length > 0 && inWindow.length === 0)) break
    cursor = page.next
  }
  return { items, capped: false }
}

/** The posts whose comments a re-run should read, from the automation's trigger. */
export function commentTargets(trigger: Trigger, pinnedMediaId: string | null, recentMedia: { id: string }[]): string[] {
  if (trigger.type !== 'comment_keyword') return []
  switch (trigger.posts.mode) {
    case 'specific':
      return trigger.posts.mediaIds
    case 'next':
      return pinnedMediaId ? [pinnedMediaId] : []
    case 'any':
      return recentMedia.map((m) => m.id)
  }
}

/** Every in-window comment on the automation's posts, sharing one cap. Used by both the preview and the worker. */
export async function gatherComments(
  adapter: PlatformAdapter,
  account: AccountCredentials,
  input: { trigger: Trigger; pinnedMediaId: string | null; since: Date; max: number },
): Promise<{ comments: CommentItem[]; capped: boolean }> {
  const recent = input.trigger.type === 'comment_keyword' && input.trigger.posts.mode === 'any' ? await adapter.listMedia(account) : []
  const comments: CommentItem[] = []
  for (const mediaId of commentTargets(input.trigger, input.pinnedMediaId, recent)) {
    const remaining = input.max - comments.length
    if (remaining <= 0) return { comments, capped: true }
    const got = await collectComments(adapter, account, mediaId, { since: input.since, max: remaining })
    comments.push(...got.items)
    if (got.capped) return { comments, capped: true }
  }
  return { comments, capped: false }
}
