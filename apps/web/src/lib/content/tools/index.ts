import { instagramDmLinkGenerator } from './instagram-dm-link-generator'
import { utmLinkBuilder } from './utm-link-builder'
import { instagramEngagementRateCalculator } from './instagram-engagement-rate-calculator'
import { instagramCharacterCounter } from './instagram-character-counter'
import type { ToolPage } from '@/lib/content/types'

export const TOOL_PAGES: ToolPage[] = [instagramDmLinkGenerator, utmLinkBuilder, instagramEngagementRateCalculator, instagramCharacterCounter]

export const getToolPage = (slug: string) => TOOL_PAGES.find((page) => page.slug === slug)
