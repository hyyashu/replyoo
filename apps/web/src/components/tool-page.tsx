import type { Metadata } from 'next'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { JsonLd } from '@/components/json-ld'
import { MarketingFooter, MarketingHeader } from '@/components/marketing'
import { TOOLS } from '@/components/tools'
import { ButtonLink } from '@/components/ui'
import { TOOL_PAGES, getToolPage } from '@/lib/content/tools'
import { getSiteUrl } from '@/lib/site'
import { breadcrumbLd, graph, organizationLd } from '@/lib/structured-data'

export const toolPath = (slug: string) => `/tools/${slug}`
export const toolStaticParams = () => TOOL_PAGES.map((page) => ({ slug: page.slug }))

export async function toolMetadata(params: Promise<{ slug: string }>): Promise<Metadata> {
  const page = getToolPage((await params).slug)
  if (!page) return {}
  return { title: page.metaTitle, description: page.description, alternates: { canonical: toolPath(page.slug) } }
}

export async function ToolPageView({ params }: { params: Promise<{ slug: string }> }) {
  const page = getToolPage((await params).slug)
  if (!page) notFound()
  const siteUrl = await getSiteUrl()
  const Tool = TOOLS[page.tool]
  const related = page.related.flatMap((slug) => getToolPage(slug) ?? [])

  return (
    <div className="bg-sand">
      <JsonLd
        data={graph(
          organizationLd(siteUrl),
          breadcrumbLd(siteUrl, [
            { name: 'Replyooo', path: '/' },
            { name: 'Free tools', path: '/tools' },
            { name: page.name, path: toolPath(page.slug) },
          ]),
          {
            '@type': 'WebApplication',
            name: page.title,
            url: `${siteUrl}${toolPath(page.slug)}`,
            description: page.description,
            applicationCategory: 'UtilitiesApplication',
            operatingSystem: 'Web',
            isAccessibleForFree: true,
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
            publisher: { '@id': `${siteUrl}/#organization` },
          },
        )}
      />
      <MarketingHeader />

      <main>
        <section className="mx-auto max-w-[860px] px-6 pt-10 pb-16">
          <Link href="/tools" className="eyebrow inline-flex items-center gap-2 text-ink-2 hover:text-ink">
            <span className="size-1.5 rounded-full bg-brand" /> Free tool
          </Link>
          <h1 className="mt-5 font-display text-[40px] leading-[1] font-extrabold tracking-[-0.045em] sm:text-[54px]">{page.title}</h1>
          <p className="mt-5 max-w-[620px] text-[17px] leading-relaxed text-muted">{page.lead}</p>
          <div className="mt-8 rounded-[28px] border border-line bg-white p-6 sm:p-8">
            <Tool />
          </div>
          <p className="mt-3 text-[12.5px] text-subtle">Free, no signup. Everything runs in your browser.</p>
        </section>

        <section className="bg-white py-16">
          <div className="mx-auto max-w-[1200px] px-6">
            <h2 className="font-display text-[32px] leading-[1.05] font-bold tracking-[-0.04em]">How to use it</h2>
            <ol className="mt-8 grid gap-5 md:grid-cols-3">
              {page.steps.map((step, index) => (
                <li key={step.title} className="rounded-[24px] bg-sand p-6">
                  <div className="eyebrow">Step 0{index + 1}</div>
                  <h3 className="mt-1 text-[18px] font-semibold">{step.title}</h3>
                  <p className="mt-1.5 text-[14px] text-muted">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="px-6 py-16">
          <div className="mx-auto flex max-w-[1200px] flex-col items-start gap-6 rounded-[32px] bg-ink p-8 text-white sm:p-10 md:flex-row md:items-center md:justify-between">
            <div className="max-w-[620px]">
              <h2 className="font-display text-[28px] leading-[1.1] font-bold tracking-[-0.03em]">{page.pitch.title}</h2>
              <p className="mt-2 text-[15px] text-white/70">{page.pitch.body}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/signup" className="h-12 px-6 text-[15px]">
                Start free <ArrowRight className="size-4" />
              </ButtonLink>
              <ButtonLink href={page.pitch.href} variant="secondary" className="h-12 px-6 text-[15px]">
                {page.pitch.cta}
              </ButtonLink>
            </div>
          </div>
        </section>

        <section className="bg-white py-16">
          <div className="mx-auto max-w-[760px] px-6">
            <h2 className="font-display text-[32px] leading-[1.05] font-bold tracking-[-0.04em]">Questions</h2>
            <dl className="mt-8 flex flex-col gap-6">
              {page.faqs.map((faq) => (
                <div key={faq.question}>
                  <dt className="text-[16px] font-semibold">{faq.question}</dt>
                  <dd className="mt-1.5 text-[14.5px] leading-relaxed text-muted">{faq.answer}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="px-6 py-16">
          <div className="mx-auto max-w-[1200px]">
            <h2 className="font-display text-[28px] font-bold tracking-[-0.03em]">More free tools</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {related.map((item) => (
                <Link key={item.slug} href={toolPath(item.slug)} className="rounded-[20px] border border-line bg-white p-5 hover:border-ink">
                  <div className="text-[15px] font-semibold">{item.title}</div>
                  <p className="mt-1 text-[13.5px] text-muted">{item.lead}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
