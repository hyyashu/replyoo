import type { SendableMessage } from './types'

export const MAX_TEXT_LENGTH = 1000
export const MAX_BUTTON_TEXT_LENGTH = 640
export const MAX_CAROUSEL_CARDS = 10
export const MAX_CARD_TEXT_LENGTH = 80

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

/**
 * Cuts on grapheme boundaries (code points without Intl.Segmenter), so an emoji or accented letter is never split
 * into a lone surrogate Meta would reject. `max` counts UTF-16 units, the way Meta measures its limits.
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  const parts = segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text)
  let out = ''
  for (const part of parts) {
    if (out.length + part.length > max - 1) break
    out += part
  }
  return `${out}…`
}

export function toGraphMessage(message: SendableMessage): Record<string, unknown> {
  if (message.kind === 'image') {
    return { attachment: { type: 'image', payload: { url: message.url } } }
  }
  if (message.kind === 'carousel') {
    return {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'generic',
          elements: message.cards.slice(0, MAX_CAROUSEL_CARDS).map((card) => ({
            title: truncate(card.title, MAX_CARD_TEXT_LENGTH),
            ...(card.subtitle ? { subtitle: truncate(card.subtitle, MAX_CARD_TEXT_LENGTH) } : {}),
            ...(card.imageUrl ? { image_url: card.imageUrl } : {}),
            buttons: [{ type: 'web_url', title: card.button.label, url: card.button.url }],
          })),
        },
      },
    }
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
