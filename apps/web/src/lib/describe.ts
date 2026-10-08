import type { FlowDefinition, Trigger } from '@replyooo/shared'

const POST_MODES: Record<string, string> = { any: 'Any post', next: 'Next post', specific: 'Specific post' }

/** Drafts are only loosely checked when saved, so a trigger field can be missing or the wrong type. */
function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function triggerLabel(trigger: Trigger): string {
  switch (trigger.type) {
    case 'comment_keyword': {
      const where = POST_MODES[String(trigger.posts?.mode)] ?? 'Post'
      return `${where} · Comment`
    }
    case 'dm_keyword':
      return 'DM · Keyword'
    case 'any_dm':
      return 'DM · Any message'
    case 'story_reply':
      return trigger.includeReactions ? 'Story · Replies & reactions' : 'Story · Replies'
    case 'ice_breaker':
      return 'DM · Conversation starters'
    default:
      return 'Automation'
  }
}

/** Short chips shown in the trigger column. */
export function triggerChips(trigger: Trigger): string[] {
  switch (trigger.type) {
    case 'comment_keyword': {
      const keywords = textList(trigger.keywords)
      return keywords.length > 0 ? keywords : ['Any comment']
    }
    case 'dm_keyword':
      return textList(trigger.keywords)
    case 'story_reply': {
      const keywords = textList(trigger.keywords)
      return keywords.length > 0 ? keywords : ['Any reply']
    }
    case 'any_dm':
      return ['Any DM']
    case 'ice_breaker':
      return [`${Array.isArray(trigger.items) ? trigger.items.length : 0} questions`]
    default:
      return []
  }
}

export function flowSearchText(name: string, flow: FlowDefinition) {
  return [name, ...triggerChips(flow.trigger)].join(' ').toLowerCase()
}
