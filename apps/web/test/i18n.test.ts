import { describe, expect, it } from 'vitest'
import { isLocale, resolveLocale } from '@/i18n/locales'
import { mergeMessages } from '@/i18n/catalogs'

describe('dashboard locale negotiation', () => {
  it('prioritizes the personal preference over a cookie from a previous session', () => {
    expect(resolveLocale({ preferred: 'es', cookie: 'en' })).toBe('es')
  })
  it('uses a supported cookie before browser negotiation', () => {
    expect(resolveLocale({ cookie: 'es', acceptLanguage: 'en' })).toBe('es')
  })
  it('matches regional tags and honors browser quality weights', () => {
    expect(resolveLocale({ acceptLanguage: 'fr;q=1,es-MX;q=0.9,en;q=0.5' })).toBe('es')
    expect(resolveLocale({ acceptLanguage: 'es;q=0,en;q=1' })).toBe('en')
    expect(resolveLocale({ acceptLanguage: 'es;q=0.2,en-GB;q=0.9' })).toBe('en')
  })
  it('rejects malformed and unsupported values without accepting inherited object properties', () => {
    expect(isLocale('__proto__')).toBe(false)
    expect(resolveLocale({ preferred: '../../secret', cookie: 'constructor' })).toBe('en')
    expect(resolveLocale({ acceptLanguage: '%%% ,es;q=no' })).toBe('en')
    expect(resolveLocale({ preferred: 'xx', acceptLanguage: 'es' })).toBe('es')
  })
  it('fills only missing messages with English while retaining translated siblings', () => {
    expect(mergeMessages({ common: { save: 'Save', cancel: 'Cancel' } }, { common: { save: 'Guardar' } }))
      .toEqual({ common: { save: 'Guardar', cancel: 'Cancel' } })
  })
})
