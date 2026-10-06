/** Only same-origin paths. Absolute URLs, `//host` and `/\host` fall back. */
export function safeNext(value: FormDataEntryValue | string | null | undefined, fallback: string): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return fallback
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback
  return value
}
