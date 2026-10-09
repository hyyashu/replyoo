import type { AlternativesPage } from '@/lib/content/types'
import { manychatAlternatives } from './manychat-alternatives'

export const ALTERNATIVES_PAGES: AlternativesPage[] = [manychatAlternatives]

export const getAlternativesPage = (slug: string) => ALTERNATIVES_PAGES.find((page) => page.slug === slug)
