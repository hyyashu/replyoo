/** Mirrors the engine's VARIABLE pattern (`packages/engine/src/render.ts`). */
const VARIABLE = /\{\{\s*([a-z0-9_.]+)\s*(?:\|([^}]*))?\}\}/g
const KNOWN = new Set(['first_name', 'display_name', 'name', 'username', 'email', 'phone'])

const isKnown = (key: string) => KNOWN.has(key) || key.startsWith('fields.') || key.startsWith('vars.')

/**
 * Problems with `{{variables}}` in a message. The engine only replaces a complete `{{name}}`, so a stray
 * brace is sent to the customer exactly as typed, and an unknown name renders as an empty string.
 */
export function variableProblems(text: string): string[] {
  const problems: string[] = []
  const rest = text.replace(VARIABLE, (match, key: string) => {
    if (!isKnown(key)) problems.push(`${match.trim()} isn't a variable we know, so it will be sent blank.`)
    return ''
  })
  if (/[{}]/.test(rest)) {
    problems.push('A { or } has no partner, so customers would see it as typed. Use the Variables menu to insert one.')
  }
  return problems
}
