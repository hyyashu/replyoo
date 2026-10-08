import type { ContactState } from './types'

const VARIABLE = /\{\{\s*([a-z0-9_.]+)\s*(?:\|([^}]*))?\}\}/g

export function renderText(
  template: string,
  contact: ContactState,
  vars: Record<string, string>,
): string {
  return template.replace(VARIABLE, (_match, key: string, fallback: string | undefined) => {
    const value = lookup(key, contact, vars)
    return value && value.length > 0 ? value : (fallback ?? '').trim()
  })
}

function lookup(key: string, contact: ContactState, vars: Record<string, string>): string | null {
  switch (key) {
    case 'first_name':
      return contact.name?.trim().split(/\s+/)[0] ?? null
    /** First name when we have one, otherwise the @username — a safe greeting for a comment reply. */
    case 'display_name':
      return contact.name?.trim().split(/\s+/)[0] || contact.username
    case 'name':
      return contact.name
    case 'username':
      return contact.username
    case 'email':
      return contact.email
    case 'phone':
      return contact.phone
  }
  if (key.startsWith('fields.')) return lookupOwn(contact.fields, key.slice('fields.'.length))
  if (key.startsWith('vars.')) return lookupOwn(vars, key.slice('vars.'.length))
  return null
}

/** Own keys only, so `{{fields.constructor}}` can't reach Object.prototype. */
function lookupOwn(record: Record<string, string>, key: string): string | null {
  return Object.hasOwn(record, key) ? (record[key] ?? null) : null
}
