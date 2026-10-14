import { bestInstagramDmAutomationTools } from './instagram-dm-automation-tools'
import type { BestPage } from '@/lib/content/types'

export const BEST_PAGES: BestPage[] = [bestInstagramDmAutomationTools]

export const getBestPage = (slug: string) => BEST_PAGES.find((page) => page.slug === slug)
