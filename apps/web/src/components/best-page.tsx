import type { Metadata } from 'next'
import { Check, Minus } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Cta, Faqs, Hero } from '@/components/compare-page'
import { JsonLd } from '@/components/json-ld'
import { MarketingFooter, MarketingHeader } from '@/components/marketing'
import { cx } from '@/components/ui'
import { BEST_PAGES, getBestPage } from '@/lib/content/best'
import { pageMetadata } from '@/lib/metadata'
import { getSiteUrl } from '@/lib/site'
import { breadcrumbLd, graph, organizationLd } from '@/lib/structured-data'

type Params = Promise<{ slug: string }>

export const bestPath = (slug: string) => `/best/${slug}`
export const bestStaticParams = () => BEST_PAGES.map((page) => ({ slug: page.slug }))

export async function bestMetadata(params: Params): Promise<Metadata> {
  const page = getBestPage((await params).slug)
  if (!page) return {}
  return pageMetadata({ title: page.metaTitle, description: page.description, path: bestPath(page.slug) })
}

const anchor = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-')

function PickList({ title, items, icon }: { title: string; items: string[]; icon: 'good' | 'bad' }) {
  return (
    <div>
      <h4 className="eyebrow">{title}</h4>
      <ul className="mt-2 flex flex-col gap-2 text-[14px] text-ink-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            {icon === 'good' ? <Check className="mt-0.5 size-4 shrink-0 text-green" /> : <Minus className="mt-0.5 size-4 shrink-0 text-brand" />} {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

export async function BestPageView({ params }: { params: Params }) {
  const page = getBestPage((await params).slug)
  if (!page) notFound()
  const siteUrl = await getSiteUrl()
  return (
    <div className="bg-sand">
      <JsonLd
        data={graph(
          organizationLd(siteUrl),
          breadcrumbLd(siteUrl, [
            { name: 'Replyooo', path: '/' },
            { name: page.name, path: bestPath(page.slug) },
          ]),
          {
            '@type': 'ItemList',
            name: page.title,
            itemListElement: page.picks.map((pick, index) => ({ '@type': 'ListItem', position: index + 1, name: pick.name })),
          },
        )}
      />
      <MarketingHeader />
      <main>
        <Hero eyebrow="Round-up" title={page.title} lead={page.lead} checked={page.checked} />

        <section className="mx-auto max-w-[900px] px-6 pb-14">
          <div className="overflow-x-auto rounded-[24px] border border-line bg-white">
            <table className="w-full min-w-[680px] border-collapse text-left text-[14px]">
              <caption className="sr-only">The tools at a glance</caption>
              <thead>
                <tr className="border-b border-line text-[13px] text-subtle">
                  <th scope="col" className="p-4 font-medium">Tool</th>
                  <th scope="col" className="p-4 font-medium">Best for</th>
                  <th scope="col" className="p-4 font-medium">Free plan</th>
                  <th scope="col" className="p-4 font-medium">Paid from</th>
                </tr>
              </thead>
              <tbody>
                {page.picks.map((pick, index) => (
                  <tr key={pick.name} className={cx(index > 0 && 'border-t border-line', 'align-top')}>
                    <th scope="row" className="p-4 font-semibold">
                      <a href={`#${anchor(pick.name)}`} className="hover:underline">{pick.name}</a>
                    </th>
                    <td className="p-4 text-ink-2">{pick.bestFor}</td>
                    <td className="p-4 text-ink-2">{pick.free}</td>
                    <td className="p-4 text-ink-2">{pick.entryPlan}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bg-white py-16">
          <div className="mx-auto max-w-[900px] px-6">
            <h2 className="font-display text-[32px] leading-[1.05] font-bold tracking-[-0.04em]">How we compared them</h2>
            <ul className="mt-6 flex flex-col gap-3 text-[15px] text-ink-2">
              {page.method.map((item) => (
                <li key={item} className="flex gap-2.5">
                  <Check className="mt-1 size-4 shrink-0 text-green" /> {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-[900px] px-6 py-16">
          <h2 className="font-display text-[32px] leading-[1.05] font-bold tracking-[-0.04em]">The tools</h2>
          <div className="mt-8 flex flex-col gap-5">
            {page.picks.map((pick) => (
              <article
                key={pick.name}
                id={anchor(pick.name)}
                className={cx('scroll-mt-6 rounded-[24px] border bg-white p-6', pick.us ? 'border-ink' : 'border-line')}
              >
                <h3 className="text-[21px] font-semibold">
                  {pick.name} {pick.us && <span className="ml-1 rounded-full bg-lime px-2.5 py-0.5 align-middle text-[11px] font-semibold">Our tool</span>}
                </h3>
                <p className="mt-1 text-[14px] text-muted"><span className="font-semibold text-ink">Best for:</span> {pick.bestFor}</p>
                <p className="mt-3 text-[14.5px] leading-relaxed text-ink-2">{pick.summary}</p>
                <dl className="mt-4 grid gap-3 rounded-2xl bg-sand p-4 text-[13.5px] sm:grid-cols-3">
                  <div>
                    <dt className="text-subtle">Free plan</dt>
                    <dd className="mt-0.5 text-ink-2">{pick.free}</dd>
                  </div>
                  <div>
                    <dt className="text-subtle">Paid from</dt>
                    <dd className="mt-0.5 text-ink-2">{pick.entryPlan}</dd>
                  </div>
                  <div>
                    <dt className="text-subtle">What’s counted</dt>
                    <dd className="mt-0.5 text-ink-2">{pick.meter}</dd>
                  </div>
                </dl>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <PickList title="Good at" items={pick.strengths} icon="good" />
                  <PickList title="Watch out for" items={pick.watchOut} icon="bad" />
                </div>
                {(pick.compareSlug || pick.us) && (
                  <div className="mt-4 flex flex-wrap gap-4 text-[14px] font-semibold">
                    {pick.compareSlug && (
                      <Link href={`/compare/${pick.compareSlug}`} className="underline">
                        Compare with Replyooo
                      </Link>
                    )}
                    {pick.us && (
                      <Link href="/signup" className="underline">
                        Start free
                      </Link>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>

        <Faqs faqs={page.faqs} />
        <Cta text="Try Replyooo on your next reel." />
      </main>
      <MarketingFooter />
    </div>
  )
}
