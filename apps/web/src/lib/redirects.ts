/**
 * Only same-origin paths. Absolute URLs, `//host`, `/\host` and values with control
 * characters (browsers strip tabs/newlines, so `/\t/evil.com` becomes `//evil.com`) fall back.
 */
export function safeNext(value: FormDataEntryValue | string | null | undefined, fallback: string): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return fallback
  if (value.startsWith('//') || /[\x00-\x1f\x7f\\]/.test(value)) return fallback
  try {
    if (new URL(value, 'http://n').origin !== 'http://n') return fallback
  } catch {
    return fallback
  }
  return value
}
