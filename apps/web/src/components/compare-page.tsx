import type { Metadata } from 'next'
import { ArrowRight, Check } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { JsonLd } from '@/components/json-ld'
import { MarketingFooter, MarketingHeader } from '@/components/marketing'
import { ButtonLink, cx } from '@/components/ui'
import { ALTERNATIVES_PAGES, getAlternativesPage } from '@/lib/content/alternatives'
import { COMPARE_PAGES, getComparePage } from '@/lib/content/compare'
import { getSiteUrl } from '@/lib/site'
import { breadcrumbLd, graph, organizationLd } from '@/lib/structured-data'

type Params = Promise<{ slug: string }>
type Kind = 'compare' | 'alternatives'

const lookup = (kind: Kind, slug: string) => (kind === 'compare' ? getComparePage(slug) : getAlternativesPage(slug))

export const compareStaticParams = (kind: Kind) => (kind === 'compare' ? COMPARE_PAGES : ALTERNATIVES_PAGES).map((page) => ({ slug: page.slug }))

export async function compareMetadata(kind: Kind, params: Params): Promise<Metadata> {
  const page = lookup(kind, (await params).slug)
  if (!page) return {}
  return { title: page.metaTitle, description: page.description, alternates: { canonical: `/${kind}/${page.slug}` } }
}

const formatDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })

function Hero({ eyebrow, title, lead, checked }: { eyebrow: string; title: string; lead: string; checked: string }) {
  return (
    <section className="mx-auto max-w-[900px] px-6 pt-10 pb-14">
      <span className="eyebrow inline-flex items-center gap-2 text-ink-2">
        <span className="size-1.5 rounded-full bg-brand" /> {eyebrow}
      </span>
      <h1 className="mt-5 font-display text-[44px] leading-[1] font-extrabold tracking-[-0.045em] sm:text-[60px]">{title}</h1>
      <p className="mt-6 max-w-[640px] text-[17px] leading-relaxed text-muted">{lead}</p>
      <p className="mt-4 text-[13px] text-subtle">
        Replyooo makes this page. Competitor details were checked on {formatDate(checked)} and may have changed since.
      </p>
    </section>
  )
}

function Faqs({ faqs }: { faqs: { question: string; answer: string }[] }) {
  return (
    <section className="bg-white py-16">
      <div className="mx-auto max-w-[760px] px-6">
        <h2 className="font-display text-[32px] leading-[1.05] font-bold tracking-[-0.04em]">Questions</h2>
        <dl className="mt-8 flex flex-col gap-6">
          {faqs.map((faq) => (
            <div key={faq.question}>
              <dt className="text-[16px] font-semibold">{faq.question}</dt>
              <dd className="mt-1.5 text-[14.5px] leading-relaxed text-muted">{faq.answer}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

function Cta({ text }: { text: string }) {
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-[900px] rounded-[28px] bg-brand px-8 py-12 text-center text-white">
        <h2 className="font-display text-[32px] leading-tight font-extrabold tracking-[-0.04em]">{text}</h2>
        <div className="mt-6 flex justify-center">
          <ButtonLink href="/signup" variant="dark" className="h-12 px-6">
            Start free <ArrowRight className="size-4" />
          </ButtonLink>
        </div>
      </div>
    </section>
  )
}

function Checks({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-[24px] bg-white p-6">
      <h3 className="text-[17px] font-semibold">{title}</h3>
      <ul className="mt-4 flex flex-col gap-3 text-[14px] text-muted">
        {items.map((item) => (
          <li key={item} className="flex gap-2.5">
            <Check className="mt-0.5 size-4 shrink-0 text-green" /> {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

export async function ComparePage({ params }: { params: Params }) {
  const page = getComparePage((await params).slug)
  if (!page) notFound()
  const siteUrl = await getSiteUrl()
  return (
    <div className="bg-sand">
      <JsonLd data={graph(organizationLd(siteUrl), breadcrumbLd(siteUrl, [{ name: 'Replyooo', path: '/' }, { name: page.name, path: `/compare/${page.slug}` }]))} />
      <MarketingHeader />
      <main>
        <Hero eyebrow="Comparison" title={page.title} lead={page.lead} checked={page.checked} />

        <section className="mx-auto max-w-[900px] px-6 pb-14">
          <div className="rounded-[24px] bg-lime-soft p-6">
            <h2 className="text-[15px] font-semibold">The short version</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{page.verdict}</p>
          </div>
        </section>

        <section className="mx-auto max-w-[900px] px-6 pb-16">
          <div className="overflow-x-auto rounded-[24px] border border-line bg-white">
            <table className="w-full min-w-[640px] border-collapse text-left text-[14px]">
              <caption className="sr-only">Replyooo compared with {page.competitor}</caption>
              <thead>
                <tr className="border-b border-line text-[13px]">
                  <th scope="col" className="p-4 font-medium text-subtle"><span className="sr-only">Feature</span></th>
                  <th scope="col" className="p-4 font-semibold">Replyooo</th>
                  <th scope="col" className="p-4 font-semibold">{page.competitor}</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((row, index) => (
                  <tr key={row.label} className={cx(index > 0 && 'border-t border-line', 'align-top')}>
                    <th scope="row" className="w-[22%] p-4 font-medium">{row.label}</th>
                    <td className="p-4 text-ink-2">{row.us}</td>
                    <td className="p-4 text-ink-2">{row.them}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mx-auto grid max-w-[900px] gap-5 px-6 pb-16 md:grid-cols-2">
          <Checks title={`Choose ${page.competitor} if`} items={page.chooseThem} />
          <Checks title="Choose Replyooo if" items={page.chooseUs} />
        </section>

        <Faqs faqs={page.faqs} />
        <Cta text="Try Replyooo on your next reel." />
      </main>
      <MarketingFooter />
    </div>
  )
}

export async function AlternativesPageView({ params }: { params: Params }) {
  const page = getAlternativesPage((await params).slug)
  if (!page) notFound()
  const siteUrl = await getSiteUrl()
  return (
    <div className="bg-sand">
      <JsonLd data={graph(organizationLd(siteUrl), breadcrumbLd(siteUrl, [{ name: 'Replyooo', path: '/' }, { name: page.name, path: `/alternatives/${page.slug}` }]))} />
      <MarketingHeader />
      <main>
        <Hero eyebrow="Alternatives" title={page.title} lead={page.lead} checked={page.checked} />

        <section className="bg-white py-16">
          <div className="mx-auto max-w-[900px] px-6">
            <h2 className="font-display text-[32px] leading-[1.05] font-bold tracking-[-0.04em]">Why people look for an alternative</h2>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {page.reasons.map((reason) => (
                <div key={reason.title} className="rounded-[24px] bg-sand p-6">
                  <h3 className="text-[16px] font-semibold">{reason.title}</h3>
                  <p className="mt-1.5 text-[14px] text-muted">{reason.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[900px] px-6 py-16">
          <h2 className="font-display text-[32px] leading-[1.05] font-bold tracking-[-0.04em]">The options</h2>
          <ol className="mt-8 flex flex-col gap-5">
            {page.options.map((option, index) => (
              <li key={option.name} className={cx('rounded-[24px] border p-6', option.us ? 'border-ink bg-white' : 'border-line bg-white')}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-[19px] font-semibold">
                    {index + 1}. {option.name} {option.us && <span className="ml-1 rounded-full bg-lime px-2.5 py-0.5 text-[11px] font-semibold">Our tool</span>}
                  </h3>
                  <span className="text-[13px] text-subtle">{option.pricing}</span>
                </div>
                <p className="mt-3 text-[14.5px] text-ink-2">{option.summary}</p>
                <p className="mt-2 text-[14px] text-muted"><span className="font-semibold text-ink">Best for:</span> {option.bestFor}</p>
                {(option.compareSlug || option.us) && (
                  <div className="mt-4 flex flex-wrap gap-4 text-[14px] font-semibold">
                    {option.compareSlug && (
                      <Link href={`/compare/${option.compareSlug}`} className="underline">
                        {option.us ? `Replyooo vs ${page.competitor}` : 'Compare with Replyooo'}
                      </Link>
                    )}
                    {option.us && <Link href="/signup" className="underline">Start free</Link>}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto max-w-[900px] px-6 pb-16">
          <Checks title={`When to stay with ${page.competitor}`} items={page.stayWith} />
        </section>

        <Faqs faqs={page.faqs} />
        <Cta text="Set up your first automation in minutes." />
      </main>
      <MarketingFooter />
    </div>
  )
}
