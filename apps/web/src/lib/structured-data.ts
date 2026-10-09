import { PLAN_CATALOG, type PlanDisplay } from '@/lib/plans'

const CONTEXT = 'https://schema.org'
// The plan prices in lib/plans.ts are display strings in USD ("$12").
const CURRENCY = 'USD'

export const organizationLd = (siteUrl: string) => ({
  '@type': 'Organization',
  '@id': `${siteUrl}/#organization`,
  name: 'Replyooo',
  url: siteUrl,
  logo: `${siteUrl}/icon.svg`,
})

export const websiteLd = (siteUrl: string) => ({
  '@type': 'WebSite',
  '@id': `${siteUrl}/#website`,
  name: 'Replyooo',
  url: siteUrl,
  publisher: { '@id': `${siteUrl}/#organization` },
})

/** Null when the display price isn't a plain amount, so we never publish a made-up number. */
export function offerLd(plan: PlanDisplay, siteUrl: string) {
  const price = Number(plan.price.replace(/^\$/, ''))
  if (!Number.isFinite(price)) return null
  return {
    '@type': 'Offer',
    name: plan.name,
    description: plan.blurb,
    price: price.toFixed(2),
    priceCurrency: CURRENCY,
    url: `${siteUrl}/pricing`,
    priceSpecification: { '@type': 'UnitPriceSpecification', price: price.toFixed(2), priceCurrency: CURRENCY, billingDuration: 'P1M' },
  }
}

export function softwareApplicationLd(plans: PlanDisplay[], siteUrl: string) {
  return {
    '@type': 'SoftwareApplication',
    '@id': `${siteUrl}/#software`,
    name: 'Replyooo',
    url: siteUrl,
    description: 'Instagram and Facebook DM automation for creators. Reply to comments, stories and DMs in seconds.',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    publisher: { '@id': `${siteUrl}/#organization` },
    offers: plans.map((plan) => offerLd(plan, siteUrl)).filter((offer) => offer !== null),
  }
}

export function breadcrumbLd(siteUrl: string, trail: { name: string; path: string }[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: `${siteUrl}${item.path}` })),
  }
}

export const freePlan = PLAN_CATALOG.filter((plan) => plan.key === 'free')

export function graph(...nodes: Record<string, unknown>[]) {
  return { '@context': CONTEXT, '@graph': nodes }
}

export function single(node: Record<string, unknown>) {
  return { '@context': CONTEXT, ...node }
}
