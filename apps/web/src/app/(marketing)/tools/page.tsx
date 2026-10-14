import type { Metadata } from 'next'
import Link from 'next/link'
import { JsonLd } from '@/components/json-ld'
import { MarketingFooter, MarketingHeader } from '@/components/marketing'
import { toolPath } from '@/components/tool-page'
import { TOOL_PAGES } from '@/lib/content/tools'
import { getSiteUrl } from '@/lib/site'
import { breadcrumbLd, graph, organizationLd } from '@/lib/structured-data'

export const metadata: Metadata = {
  title: 'Free Instagram tools',
  description: 'Free tools for Instagram creators: DM reply generator, DM link generator, UTM link builder, engagement rate calculator and character counter. No signup.',
  alternates: { canonical: '/tools' },
}

export default async function ToolsPage() {
  const siteUrl = await getSiteUrl()
  return (
    <div className="bg-sand">
      <JsonLd
        data={graph(
          organizationLd(siteUrl),
          breadcrumbLd(siteUrl, [
            { name: 'Replyooo', path: '/' },
            { name: 'Free tools', path: '/tools' },
          ]),
        )}
      />
      <MarketingHeader />
      <main className="mx-auto max-w-[1200px] px-6 pt-10 pb-20">
        <span className="eyebrow inline-flex items-center gap-2 text-ink-2">
          <span className="size-1.5 rounded-full bg-brand" /> Free tools
        </span>
        <h1 className="mt-5 font-display text-[44px] leading-[1] font-extrabold tracking-[-0.045em] sm:text-[60px]">Free Instagram tools</h1>
        <p className="mt-6 max-w-[560px] text-[17px] leading-relaxed text-muted">
          Small tools for the everyday parts of running an Instagram account. Free, no signup, and everything runs in your browser.
        </p>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {TOOL_PAGES.map((page) => (
            <Link key={page.slug} href={toolPath(page.slug)} className="rounded-[24px] border border-line bg-white p-6 hover:border-ink">
              <h2 className="text-[18px] font-semibold">{page.title}</h2>
              <p className="mt-1.5 text-[14px] text-muted">{page.lead}</p>
            </Link>
          ))}
        </div>
      </main>
      <MarketingFooter />
    </div>
  )
}
