import type { SendableMessage } from './types'

export const MAX_TEXT_LENGTH = 1000
export const MAX_BUTTON_TEXT_LENGTH = 640

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

export function toGraphMessage(message: SendableMessage): Record<string, unknown> {
  if (message.kind === 'image') {
    return { attachment: { type: 'image', payload: { url: message.url } } }
  }
  const buttons = message.buttons ?? []
  if (buttons.length === 0) return { text: truncate(message.text, MAX_TEXT_LENGTH) }
  return {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'button',
        text: truncate(message.text, MAX_BUTTON_TEXT_LENGTH),
        buttons: buttons.map((button) =>
          button.type === 'url'
            ? { type: 'web_url', title: button.label, url: button.url }
            : { type: 'postback', title: button.label, payload: button.payload },
        ),
      },
    },
  }
}
