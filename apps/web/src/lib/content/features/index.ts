import { instagramCommentToDm } from './instagram-comment-to-dm'
import { instagramFollowGate } from './instagram-follow-gate'
import { collectEmailsInstagramDm } from './collect-emails-instagram-dm'
import { instagramStoryReplyAutomation } from './instagram-story-reply-automation'
import { instagramDmAutoReply } from './instagram-dm-auto-reply'
import type { MarketingPage } from '@/lib/content/types'

export const FEATURE_PAGES: MarketingPage[] = [
  instagramCommentToDm,
  instagramFollowGate,
  collectEmailsInstagramDm,
  instagramStoryReplyAutomation,
  instagramDmAutoReply,
]
