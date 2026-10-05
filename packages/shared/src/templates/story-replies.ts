import type { FlowTemplate } from './types'

export const storyReplies: FlowTemplate = {
  key: 'story_replies',
  title: 'Reply to story reactions and comments',
  description: 'Triggers when someone reacts or replies to your story',
  categories: ['engage_audience'],
  platforms: ['instagram'],
  flow: {
    trigger: { type: 'story_reply', includeReactions: true },
    start: 'thanks',
    steps: {
      thanks: { type: 'send_message', text: 'Thanks for watching my story, {{first_name|friend}}! 💛' },
    },
  },
}
