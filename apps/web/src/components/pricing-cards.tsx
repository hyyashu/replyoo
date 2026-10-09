'use client'

import type { BillingInterval } from '@replyooo/shared'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { ButtonLink, cx } from '@/components/ui'
import type { PlanCard } from '@/lib/billing/plan-cards'

export function IntervalToggle({
  value,
  onChange,
  saveLabel,
}: {
  value: BillingInterval
  onChange: (value: BillingInterval) => void
  saveLabel: string | null
}) {
  const option = (interval: BillingInterval, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === interval}
      onClick={() => onChange(interval)}
      className={cx('rounded-full px-4 py-1.5 text-[13.5px] font-semibold', value === interval ? 'bg-ink text-white' : 'text-muted hover:text-ink')}
    >
      {label}
    </button>
  )
  return (
    <div className="inline-flex items-center gap-3">
      <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-full border border-line bg-white p-1">
        {option('month', 'Monthly')}
        {option('year', 'Yearly')}
      </div>
      {saveLabel && <span className="rounded-full bg-lime px-2.5 py-0.5 text-[12px] font-semibold text-ink">{saveLabel}</span>}
    </div>
  )
}

export function PricingCardsView({ cards, yearly, saveLabel }: { cards: PlanCard[]; yearly: boolean; saveLabel: string | null }) {
  const [interval, setBilling] = useState<BillingInterval>('month')
  const showYear = yearly && interval === 'year'
  return (
    <>
      {yearly && (
        <div className="mt-10 flex justify-center">
          <IntervalToggle value={interval} onChange={setBilling} saveLabel={saveLabel} />
        </div>
      )}
      <div className={cx('mx-auto grid max-w-[980px] gap-5 text-left md:grid-cols-3', yearly ? 'mt-8' : 'mt-12')}>
        {cards.map((plan) => (
          <div
            key={plan.key}
            className={cx('flex flex-col rounded-[24px] border p-7', plan.featured ? 'border-ink bg-ink text-white' : 'border-line bg-white')}
          >
            <div className="flex items-center justify-between">
              <span className="text-[16px] font-semibold">{plan.name}</span>
              {plan.featured && <span className="rounded-full bg-lime px-2.5 py-0.5 text-[11px] font-semibold text-ink">Most popular</span>}
            </div>
            <div className="mt-4 font-display text-[44px] leading-none font-bold tracking-[-0.04em]">
              {showYear && plan.year ? plan.year : plan.month}
              <span className={cx('font-sans text-[14px] font-normal tracking-normal', plan.featured ? 'text-white/50' : 'text-subtle')}>
                {showYear && plan.year ? '/year' : '/month'}
              </span>
            </div>
            {showYear && plan.savePercent !== null && (
              <p className={cx('mt-2 text-[12.5px] font-semibold', plan.featured ? 'text-lime' : 'text-green')}>Save {plan.savePercent}%</p>
            )}
            <p className={cx('mt-3 text-[14px]', plan.featured ? 'text-white/60' : 'text-muted')}>{plan.blurb}</p>
            <ButtonLink href="/signup" variant={plan.featured ? 'primary' : 'secondary'} className="mt-6">
              {plan.key === 'free' ? 'Start free' : `Go ${plan.name}`}
            </ButtonLink>
            <ul className="mt-6 flex flex-col gap-2.5 text-[14px]">
              {plan.perks.map((perk) => (
                <li key={perk} className="flex items-center gap-2">
                  <Check className={cx('size-4', plan.featured ? 'text-lime' : 'text-green')} /> {perk}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  )
}
