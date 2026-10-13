import type { TriggerCandidate } from './router'
import { matchAutomation } from './router'

/** Meta only allows a private reply within 7 days of the comment. */
export const PRIVATE_REPLY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface BackfillComment {
  id: string
  mediaId: string
  text: string
  createdAt: Date
}

export type BackfillBucket = 'handled' | 'too_old' | 'no_match' | 'eligible'

/**
 * Sorts comments for a re-run of one automation. Keyword and post rules come from `matchAutomation`, with the
 * automation as the only candidate, so a re-run can never be answered by a different automation.
 */
export function classifyComments<T extends BackfillComment>(
  comments: readonly T[],
  candidate: TriggerCandidate,
  handled: ReadonlySet<string>,
  now: Date,
): Record<BackfillBucket, T[]> {
  const result: Record<BackfillBucket, T[]> = { handled: [], too_old: [], no_match: [], eligible: [] }
  for (const comment of comments) {
    if (handled.has(comment.id)) {
      result.handled.push(comment)
    } else if (now.getTime() - comment.createdAt.getTime() > PRIVATE_REPLY_MAX_AGE_MS) {
      result.too_old.push(comment)
    } else if (
      !matchAutomation({ kind: 'comment', text: comment.text, mediaId: comment.mediaId, mediaPublishedAt: null }, [candidate])
    ) {
      result.no_match.push(comment)
    } else {
      result.eligible.push(comment)
    }
  }
  result.eligible.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  return result
}
