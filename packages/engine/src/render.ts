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
    case 'name':
      return contact.name
    case 'username':
      return contact.username
    case 'email':
      return contact.email
    case 'phone':
      return contact.phone
  }
  if (key.startsWith('fields.')) return contact.fields[key.slice('fields.'.length)] ?? null
  if (key.startsWith('vars.')) return vars[key.slice('vars.'.length)] ?? null
  return null
}
