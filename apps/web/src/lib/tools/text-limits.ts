import { MAX_BUTTON_TEMPLATE_TEXT } from '@replyooo/shared'

export type TextLimitKey = 'caption' | 'bio' | 'dm' | 'dm_buttons'

/** Character limits we can back up: Instagram's own caption and bio limits, and the Meta messaging limits Replyooo enforces. */
export const TEXT_LIMITS: Record<TextLimitKey, { label: string; max: number }> = {
  caption: { label: 'Instagram caption', max: 2200 },
  bio: { label: 'Instagram bio', max: 150 },
  dm: { label: 'Automated DM', max: 1000 },
  dm_buttons: { label: 'Automated DM with buttons', max: MAX_BUTTON_TEMPLATE_TEXT },
}

/** Counts characters the way people see them, so an emoji or an accented letter counts once. */
export function countCharacters(text: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length
}

export function textStats(text: string) {
  return {
    characters: countCharacters(text),
    words: text.trim() ? text.trim().split(/\s+/).length : 0,
    hashtags: text.match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.length ?? 0,
    mentions: text.match(/(^|\s)@[\w.]+/g)?.length ?? 0,
    lines: text ? text.split('\n').length : 0,
  }
}
