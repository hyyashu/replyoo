import type { Metadata } from 'next'
import { ArrowRight, Check } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { JsonLd } from '@/components/json-ld'
import { MarketingFooter, MarketingHeader } from '@/components/marketing'
import { PhonePreview } from '@/components/phone-preview'
import { ButtonLink } from '@/components/ui'
import { SECTIONS, getPage, pagePath, type SectionKey } from '@/lib/content/sections'
import { getSiteUrl } from '@/lib/site'
import { breadcrumbLd, graph, organizationLd } from '@/lib/structured-data'

export const sectionStaticParams = (section: SectionKey) => SECTIONS[section].pages.map((page) => ({ slug: page.slug }))

export async function sectionMetadata(section: SectionKey, params: Promise<{ slug: string }>): Promise<Metadata> {
  const page = getPage(section, (await params).slug)
  if (!page) return {}
  return { title: page.metaTitle, description: page.description, alternates: { canonical: pagePath(section, page.slug) } }
}

export async function SectionPage({ section, params }: { section: SectionKey; params: Promise<{ slug: string }> }) {
  const page = getPage(section, (await params).slug)
  if (!page) notFound()
  const siteUrl = await getSiteUrl()
  const related = page.related.flatMap((slug) => getPage(section, slug) ?? [])

  return (
    <div className="bg-sand">
      <JsonLd
        data={graph(
          organizationLd(siteUrl),
          breadcrumbLd(siteUrl, [
            { name: 'Replyooo', path: '/' },
            { name: page.name, path: pagePath(section, page.slug) },
          ]),
        )}
      />
      <MarketingHeader />

      <main>
        <section className="mx-auto grid max-w-[1200px] items-center gap-12 px-6 pt-10 pb-20 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <span className="eyebrow inline-flex items-center gap-2 text-ink-2">
              <span className="size-1.5 rounded-full bg-brand" /> {page.name}
            </span>
            <h1 className="mt-5 font-display text-[44px] leading-[1] font-extrabold tracking-[-0.045em] sm:text-[60px]">{page.title}</h1>
            <p className="mt-6 max-w-[520px] text-[17px] leading-relaxed text-muted">{page.lead}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/signup" className="h-12 px-6 text-[15px]">
                Start free — no card needed <ArrowRight className="size-4" />
              </ButtonLink>
              <ButtonLink href="/pricing" variant="secondary" className="h-12 border-ink px-6 text-[15px]">
                See pricing
              </ButtonLink>
            </div>
          </div>
          <div className="rounded-[32px] bg-[linear-gradient(160deg,#ffd7c4,#ffb59a)] px-6 py-10">
            <div className="scale-[0.92]">
              <PhonePreview recipe={page.recipe} mode={page.mode} username={page.username} />
            </div>
          </div>
        </section>

        <section className="bg-white py-20">
          <div className="mx-auto max-w-[1200px] px-6">
            <h2 className="font-display text-[36px] leading-[1.05] font-bold tracking-[-0.04em]">How it works</h2>
            <ol className="mt-10 grid gap-5 md:grid-cols-3">
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

        <section className="py-20">
          <div className="mx-auto max-w-[1200px] px-6">
            <h2 className="font-display text-[36px] leading-[1.05] font-bold tracking-[-0.04em]">What you get</h2>
            <ul className="mt-10 grid gap-x-10 gap-y-6 md:grid-cols-2">
              {page.points.map((point) => (
                <li key={point.title} className="flex gap-3">
                  <Check className="mt-1 size-4 shrink-0 text-green" />
                  <div>
                    <h3 className="text-[16px] font-semibold">{point.title}</h3>
                    <p className="mt-1 text-[14px] text-muted">{point.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="bg-white py-20">
          <div className="mx-auto max-w-[760px] px-6">
            <h2 className="font-display text-[36px] leading-[1.05] font-bold tracking-[-0.04em]">Questions</h2>
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

        <section className="px-6 py-20">
          <div className="mx-auto max-w-[1200px]">
            <h2 className="font-display text-[28px] font-bold tracking-[-0.03em]">More ways to use Replyooo</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {related.map((item) => (
                <Link key={item.slug} href={pagePath(section, item.slug)} className="rounded-[20px] border border-line bg-white p-5 hover:border-ink">
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
