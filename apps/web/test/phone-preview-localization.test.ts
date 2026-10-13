import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { createTranslator } from 'next-intl'
import { expect, it } from 'vitest'
import { PhonePreview } from '@/components/phone-preview'
import { DEFAULT_RECIPE } from '@/lib/recipe'
import es from '../messages/es.json'

it('renders the public marketing preview in English without a dashboard provider', () => {
  const html = renderToString(createElement(PhonePreview, { recipe: DEFAULT_RECIPE, mode: 'dm', username: 'example' }))
  expect(html).toContain('Active now')
})

it('translates dashboard preview chrome while preserving customer-written messages', () => {
  const t = createTranslator({ locale: 'es', messages: es, namespace: 'shared' })
  const recipe = structuredClone(DEFAULT_RECIPE)
  recipe.message.text = 'Active now — this is customer content'
  const html = renderToString(
    createElement(PhonePreview, {
      recipe,
      mode: 'dm',
      username: 'example',
      translate: (key: string, values?: Record<string, string | number>) => t(key as keyof typeof es.shared, values),
    }),
  )
  expect(html).toContain('Activo ahora')
  expect(html).toContain('Active now — this is customer content')
})
