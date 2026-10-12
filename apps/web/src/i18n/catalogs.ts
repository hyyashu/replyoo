import type { AbstractIntlMessages } from 'next-intl'
import type { Locale } from './locales'

const loaders = {
  en: () => import('../../messages/en.json').then((module) => module.default),
  es: () => import('../../messages/es.json').then((module) => module.default),
}

export function mergeMessages(base: AbstractIntlMessages, selected: AbstractIntlMessages): AbstractIntlMessages {
  return Object.fromEntries(Object.entries(base).map(([key, value]) => {
    const translated = Object.hasOwn(selected, key) ? selected[key] : undefined
    return [key, typeof value === 'string' ? (typeof translated === 'string' ? translated : value)
      : mergeMessages(value, typeof translated === 'object' && translated ? translated : {})]
  }))
}

export async function loadMessages(locale: Locale): Promise<AbstractIntlMessages> {
  const english = await loaders.en()
  return locale === 'en' ? english : mergeMessages(english, await loaders[locale]())
}
