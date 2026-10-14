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

it('shows a carousel of product cards in the preview', () => {
  const recipe = structuredClone(DEFAULT_RECIPE)
  recipe.message.format = 'products'
  recipe.message.text = 'My favourites'
  recipe.message.cards = [
    { title: 'Mug', subtitle: '$19', imageUrl: '', buttonLabel: 'Buy', buttonUrl: 'https://shop.example.com/mug' },
    { title: 'Cap', subtitle: '', imageUrl: '', buttonLabel: 'See it', buttonUrl: 'https://shop.example.com/cap' },
  ]
  const html = renderToString(createElement(PhonePreview, { recipe, mode: 'dm', username: 'example' }))
  expect(html).toContain('My favourites')
  expect(html).toContain('Mug')
  expect(html).toContain('$19')
  expect(html).toContain('Cap')
  expect(html).toContain('Buy')
})
