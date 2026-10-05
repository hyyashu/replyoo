const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Request-supplied IDs are checked before they reach a uuid column (Postgres would throw a 500). */
export function isUuid(value: string): boolean {
  return UUID.test(value)
}
