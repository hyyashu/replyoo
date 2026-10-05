import type { FlowDefinition, Trigger } from '@replyooo/shared'

export function triggerLabel(trigger: Trigger): string {
  switch (trigger.type) {
    case 'comment_keyword': {
      const where = { any: 'Any post', next: 'Next post', specific: 'Specific post' }[trigger.posts.mode]
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
  }
}

/** Short chips shown in the trigger column. */
export function triggerChips(trigger: Trigger): string[] {
  switch (trigger.type) {
    case 'comment_keyword':
    case 'dm_keyword':
      return trigger.keywords
    case 'story_reply':
      return trigger.keywords?.length ? trigger.keywords : ['Any reply']
    case 'any_dm':
      return ['Any DM']
    case 'ice_breaker':
      return [`${trigger.items.length} questions`]
  }
}

export function flowSearchText(name: string, flow: FlowDefinition) {
  return [name, ...triggerChips(flow.trigger)].join(' ').toLowerCase()
}
