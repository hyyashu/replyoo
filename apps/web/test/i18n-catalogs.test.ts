import { expect, it } from 'vitest'
import { validateCatalogs, validateSourceMessages } from '../scripts/check-translations'

it('rejects missing translations, invalid ICU and changed parameters', () => {
  expect(validateCatalogs({ greeting: 'Hello {name}' }, {})).toContain('Missing: greeting')
  expect(validateCatalogs({ greeting: 'Hello {name}' }, { greeting: 'Hola {nombre}' })).toContain('Arguments differ: greeting')
  expect(validateCatalogs({ greeting: 'Hello' }, { greeting: 'Hola {' }).some((error) => error.startsWith('Invalid ICU: greeting'))).toBe(true)
})

it('accepts translated sentences with the same arguments and plural types', () => {
  expect(
    validateCatalogs({ count: '{n, plural, one {# item} other {# items}}' }, { count: '{n, plural, one {# elemento} other {# elementos}}' }),
  ).toEqual([])
})

it('rejects a source message key missing from both catalogs', () => {
  const source = "const tr = useTranslations('contacts'); return tr('fields', {v0: key})"
  expect(validateSourceMessages(source, { contacts: { title: 'Contacts' } })).toEqual(['Unknown message: contacts.fields'])
})
