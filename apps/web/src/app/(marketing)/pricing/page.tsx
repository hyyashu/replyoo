import type { Metadata } from 'next'
import { JsonLd } from '@/components/json-ld'
import { MarketingFooter, MarketingHeader, PricingCards } from '@/components/marketing'
import { PLAN_CATALOG } from '@/lib/plans'
import { getSiteUrl } from '@/lib/site'
import { graph, organizationLd, softwareApplicationLd } from '@/lib/structured-data'

export const metadata: Metadata = { title: 'Pricing', alternates: { canonical: '/pricing' } }

export default async function PricingPage() {
  const siteUrl = await getSiteUrl()
  return (
    <div className="bg-sand">
      <JsonLd data={graph(organizationLd(siteUrl), softwareApplicationLd(PLAN_CATALOG, siteUrl))} />
      <MarketingHeader />
      <main className="px-6 py-16 text-center">
        <h1 className="font-display text-[52px] leading-tight font-bold tracking-[-0.04em]">Free until it’s working.</h1>
        <p className="mt-2 text-[15px] text-muted">
          Plans are metered on contacts reached per month: a person counts once a month, the first time Replyooo messages them.
        </p>
        <PricingCards />
        <p className="mx-auto mt-10 max-w-[620px] text-[13.5px] text-subtle">
          When you reach your monthly contacts, conversations already in progress finish and new ones pause until the 1st of the next
          month, or until you upgrade. Payments are handled by Dodo Payments, our merchant of record. Cancel any time from Settings →
          Billing.
        </p>
      </main>
      <MarketingFooter />
    </div>
  )
}
