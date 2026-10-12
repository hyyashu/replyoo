import type { FlowDefinition, Trigger } from '@replyooo/shared'

const POST_MODES: Record<string, string> = { any: 'Any post', next: 'Next post', specific: 'Specific post' }
type Translate = (key: string, values?: Record<string, string | number>) => string

/** Drafts are only loosely checked when saved, so a trigger field can be missing or the wrong type. */
function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function triggerLabel(trigger: Trigger, translate?: Translate): string {
  switch (trigger.type) {
    case 'comment_keyword': {
      const mode = String(trigger.posts?.mode)
      const where = translate ? translate(Object.hasOwn(POST_MODES, mode) ? `post_${mode}` : 'post') : (POST_MODES[mode] ?? 'Post')
      return translate ? translate('comment', { where }) : `${where} · Comment`
    }
    case 'dm_keyword':
      return translate ? translate('dm_keyword') : 'DM · Keyword'
    case 'any_dm':
      return translate ? translate('any_dm') : 'DM · Any message'
    case 'story_reply':
      return translate
        ? translate(trigger.includeReactions ? 'story_reactions' : 'story')
        : trigger.includeReactions
          ? 'Story · Replies & reactions'
          : 'Story · Replies'
    case 'ice_breaker':
      return translate ? translate('starters') : 'DM · Conversation starters'
    default:
      return translate ? translate('automation') : 'Automation'
  }
}

/** Short chips shown in the trigger column. */
export function triggerChips(trigger: Trigger, translate?: Translate): string[] {
  switch (trigger.type) {
    case 'comment_keyword': {
      const keywords = textList(trigger.keywords)
      return keywords.length > 0 ? keywords : [translate ? translate('any_comment') : 'Any comment']
    }
    case 'dm_keyword':
      return textList(trigger.keywords)
    case 'story_reply': {
      const keywords = textList(trigger.keywords)
      return keywords.length > 0 ? keywords : [translate ? translate('any_reply') : 'Any reply']
    }
    case 'any_dm':
      return [translate ? translate('any_dm_chip') : 'Any DM']
    case 'ice_breaker':
      return [
        translate
          ? translate('questions', { count: Array.isArray(trigger.items) ? trigger.items.length : 0 })
          : `${Array.isArray(trigger.items) ? trigger.items.length : 0} questions`,
      ]
    default:
      return []
  }
}

export function flowSearchText(name: string, flow: FlowDefinition) {
  return [name, ...triggerChips(flow.trigger)].join(' ').toLowerCase()
}
