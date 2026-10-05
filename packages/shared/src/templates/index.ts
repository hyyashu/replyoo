import { commentToDm } from './comment-to-dm'
import { conversationStarters } from './conversation-starters'
import { dmKeyword } from './dm-keyword'
import { emailList } from './email-list'
import { followGate } from './follow-gate'
import { phoneNumbers } from './phone-numbers'
import { storyReplies } from './story-replies'
import type { FlowTemplate } from './types'

export type { FlowTemplate, TemplateCategory } from './types'

export const TEMPLATES: readonly FlowTemplate[] = [
  conversationStarters,
  dmKeyword,
  storyReplies,
  followGate,
  emailList,
  phoneNumbers,
  commentToDm,
]

export function getTemplate(key: string): FlowTemplate | undefined {
  return TEMPLATES.find((template) => template.key === key)
}
