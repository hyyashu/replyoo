import type { FlowTemplate } from './types'

export const dmKeyword: FlowTemplate = {
  key: 'dm_keyword',
  title: 'Respond to all your DMs',
  description: 'Set up automation on DMs for specific keywords when someone DMs you',
  categories: ['setup_inbox'],
  platforms: ['instagram', 'facebook'],
  flow: {
    trigger: { type: 'dm_keyword', keywords: ['PRICE'], match: 'contains' },
    start: 'reply',
    steps: {
      reply: {
        type: 'send_message',
        text: 'Hey {{first_name|there}}! Here are our prices 👇',
        buttons: [{ type: 'url', label: 'See pricing', url: 'https://example.com/pricing' }],
      },
    },
  },
}
