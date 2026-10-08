export type AnswerKind = 'email' | 'phone' | 'text'

const EMAIL = /[^\s@<>()[\]{}"'`“”‘’«»,;:]+@[^\s@<>()[\]{}"'`“”‘’«»,;:]+\.\p{L}{2,}/u
const PHONE = /(?<!\d)\+?\d{7,15}(?!\d)/

export function parseAnswer(text: string, kind: AnswerKind): string | null {
  switch (kind) {
    case 'email': {
      const match = text.match(EMAIL)
      return match ? match[0].toLowerCase() : null
    }
    case 'phone': {
      const compact = text.replace(/[\s\-().]/g, '')
      const match = compact.match(PHONE)
      return match ? match[0] : null
    }
    case 'text': {
      const trimmed = text.trim()
      return trimmed.length > 0 && trimmed.length <= 500 ? trimmed : null
    }
  }
}
