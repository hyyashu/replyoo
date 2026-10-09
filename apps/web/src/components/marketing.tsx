import { ArrowRight } from 'lucide-react'
import { headers } from 'next/headers'
import Link from 'next/link'
import { PricingCardsView } from '@/components/pricing-cards'
import { ButtonLink, Logo, cx } from '@/components/ui'
import { ALTERNATIVES_PAGES } from '@/lib/content/alternatives'
import { COMPARE_PAGES } from '@/lib/content/compare'
import { displayPrices, planCards, requestCountry, saveLabel } from '@/lib/billing/pricing'
import { SECTION_KEYS, SECTIONS, pagePath } from '@/lib/content/sections'

export function MarketingHeader() {
  return (
    <header className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-5">
      <Link href="/">
        <Logo />
      </Link>
      <nav className="hidden items-center gap-8 text-[14px] text-muted md:flex">
        <Link href="/#how" className="hover:text-ink">How it works</Link>
        <Link href="/#features" className="hover:text-ink">Features</Link>
        <Link href="/pricing" className="hover:text-ink">Pricing</Link>
      </nav>
      <div className="flex items-center gap-2">
        <Link href="/login" className="px-3 text-[14px] font-semibold">
          Log in
        </Link>
        <ButtonLink href="/signup" size="sm">
          Start free <ArrowRight className="size-3.5" />
        </ButtonLink>
      </div>
    </header>
  )
}

export function MarketingFooter() {
  return (
    <footer className="mx-auto max-w-[1200px] px-6 pt-4 pb-12 text-[13px] text-subtle">
      <div className="flex flex-wrap items-start justify-between gap-8">
        <Logo />
        {SECTION_KEYS.map((section) => (
          <nav key={section} aria-label={SECTIONS[section].label} className="flex flex-col gap-2">
            <span className="eyebrow">{SECTIONS[section].label}</span>
            {SECTIONS[section].pages.map((page) => (
              <Link key={page.slug} href={pagePath(section, page.slug)} className="hover:text-ink">{page.name}</Link>
            ))}
          </nav>
        ))}
        <nav aria-label="Compare" className="flex flex-col gap-2">
          <span className="eyebrow">Compare</span>
          {COMPARE_PAGES.map((page) => (
            <Link key={page.slug} href={`/compare/${page.slug}`} className="hover:text-ink">{page.name}</Link>
          ))}
          {ALTERNATIVES_PAGES.map((page) => (
            <Link key={page.slug} href={`/alternatives/${page.slug}`} className="hover:text-ink">{page.name}</Link>
          ))}
        </nav>
        <nav aria-label="Company" className="flex flex-col gap-2">
          <span className="eyebrow">Company</span>
          <Link href="/pricing" className="hover:text-ink">Pricing</Link>
          <Link href="/privacy" className="hover:text-ink">Privacy</Link>
          <Link href="/terms" className="hover:text-ink">Terms</Link>
          <Link href="/data-deletion" className="hover:text-ink">Data deletion</Link>
        </nav>
      </div>
      <p className="mt-8">© {new Date().getFullYear()} Replyooo. Not affiliated with Instagram or Meta.</p>
    </footer>
  )
}

/** Prices for the visitor's country (Cloudflare CF-IPCountry); reading headers keeps the page dynamic and uncached. */
export async function PricingCards() {
  const prices = await displayPrices(requestCountry(await headers()))
  return <PricingCardsView cards={planCards(prices)} yearly={prices.yearly} saveLabel={saveLabel(prices)} />
}

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="bg-sand">
      <MarketingHeader />
      <main className="mx-auto max-w-[760px] px-6 py-16">
        <h1 className="font-display text-[44px] leading-tight font-bold tracking-[-0.04em]">{title}</h1>
        <p className="mt-2 text-[13.5px] text-subtle">Last updated {updated}</p>
        <div className="mt-10 flex flex-col gap-5 text-[15px] leading-relaxed text-ink-2 [&_h2]:mt-6 [&_h2]:text-[20px] [&_h2]:font-semibold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5 [&_a]:underline">
          {children}
        </div>
      </main>
      <MarketingFooter />
    </div>
  )
}
