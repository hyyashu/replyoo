import type { PreviewMode } from '@/components/phone-preview'
import type { Recipe } from '@/lib/recipe'

export interface Source {
  label: string
  url: string
}

export type FAQ = { question: string; answer: string }

/**
 * What we know about one competitor, in one place. Compare and alternatives pages both read from it,
 * so a price changes here once. Sources are not shown on the page; they tell the next refresh what to re-check.
 */
export interface Competitor {
  name: string
  /** When these facts were last read from the competitor's own pages (YYYY-MM-DD). */
  checked: string
  sources: Source[]
  free: string
  /** One line for the alternatives list: free plan plus paid pricing. */
  paid: string
  entryPlan: string
  allowance: string
  meter: string
}

/** A head-to-head page: /compare/<slug>. */
export interface ComparisonPage {
  slug: string
  /** Breadcrumb and footer label. */
  name: string
  competitor: string
  title: string
  metaTitle: string
  description: string
  lead: string
  verdict: string
  rows: { label: string; us: string; them: string }[]
  chooseThem: string[]
  chooseUs: string[]
  faqs: FAQ[]
  /** Where each competitor fact came from. Not shown on the page; kept so the next refresh knows what to re-check. */
  sources: Source[]
  /** When the competitor's facts were last read from their own pages (YYYY-MM-DD). */
  checked: string
  /** Last real content change (YYYY-MM-DD); feeds the sitemap, so bump it by hand. */
  updated: string
}

/** A "<tool> alternatives" page: /alternatives/<slug>. */
export interface AlternativesPage {
  slug: string
  name: string
  competitor: string
  title: string
  metaTitle: string
  description: string
  lead: string
  /** Why people look for an alternative, stated as facts about the tool. */
  reasons: { title: string; body: string }[]
  options: { name: string; us?: boolean; compareSlug?: string; bestFor: string; summary: string; pricing: string }[]
  stayWith: string[]
  faqs: FAQ[]
  /** Where each competitor fact came from. Not shown on the page; kept so the next refresh knows what to re-check. */
  sources: Source[]
  checked: string
  updated: string
}


/** One programmatic marketing page. The same shape drives /features, /use-cases and /for. */
export interface MarketingPage {
  slug: string
  /** Short label for links and breadcrumbs. */
  name: string
  /** The H1, written around the phrase people search for. */
  title: string
  /** `<title>` before the " · Replyooo" suffix. */
  metaTitle: string
  description: string
  lead: string
  recipe: Recipe
  mode: PreviewMode
  username: string
  steps: { title: string; body: string }[]
  points: { title: string; body: string }[]
  faqs: { question: string; answer: string }[]
  related: string[]
  /** Slugs of free tools (`tools/`) worth linking from this page. */
  tools?: string[]
  /** Date the content last really changed (YYYY-MM-DD); feeds the sitemap, so bump it by hand when you edit the page. */
  updated: string
}

export type ToolKey = 'dm-link' | 'dm-replies' | 'utm' | 'engagement' | 'text-limits'

/** A free tool page: /tools/<slug>. The tool itself is a client component picked by `tool`; the rest is the page around it. */
export interface ToolPage {
  slug: string
  /** Short label for links, breadcrumbs and the footer. */
  name: string
  tool: ToolKey
  title: string
  metaTitle: string
  description: string
  lead: string
  steps: { title: string; body: string }[]
  /** How the Replyooo product connects to this tool, shown under it. */
  pitch: { title: string; body: string; href: string; cta: string }
  faqs: FAQ[]
  related: string[]
  /** Last real content change (YYYY-MM-DD); feeds the sitemap, so bump it by hand. */
  updated: string
}

/** One tool on a best-of page. Facts come from `competitors/` (or `ours`) so prices change in one place. */
export interface BestPick {
  name: string
  us?: boolean
  compareSlug?: string
  bestFor: string
  summary: string
  free: string
  entryPlan: string
  meter: string
  strengths: string[]
  /** Where it falls short. Every pick has at least one, ours included. */
  watchOut: string[]
}

/** A "best X" round-up: /best/<slug>. Picks are grouped by who they suit, not ranked. */
export interface BestPage {
  slug: string
  name: string
  title: string
  metaTitle: string
  description: string
  lead: string
  /** How the tools were chosen and compared, shown near the top. */
  method: string[]
  picks: BestPick[]
  faqs: FAQ[]
  /** Where each competitor fact came from. Not shown on the page. */
  sources: Source[]
  /** The oldest `checked` date among the competitors on the page. */
  checked: string
  updated: string
}
