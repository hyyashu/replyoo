'use client'

import type { BillingInterval, PlanKey } from '@replyooo/shared'
import { useState } from 'react'
import { IntervalToggle } from '@/components/pricing-cards'
import { Card, buttonClass, cx } from '@/components/ui'
import { isCurrentCard, type PlanCard } from '@/lib/billing/plan-cards'

export function BillingPlans({
  cards,
  yearly,
  saveLabel,
  current,
  canAct,
  hasBillingAccount,
  switchPlan,
  openBillingPortal,
}: {
  cards: PlanCard[]
  yearly: boolean
  saveLabel: string | null
  current: { plan: PlanKey; interval: BillingInterval }
  canAct: boolean
  hasBillingAccount: boolean
  switchPlan: (formData: FormData) => Promise<void>
  openBillingPortal: () => Promise<void>
}) {
  const [interval, setBilling] = useState<BillingInterval>(yearly && current.plan !== 'free' ? current.interval : 'month')
  const shown: BillingInterval = yearly ? interval : 'month'
  return (
    <>
      {yearly && (
        <div className="mt-4">
          <IntervalToggle value={interval} onChange={setBilling} saveLabel={saveLabel} />
        </div>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {cards.map((plan) => {
          const isCurrent = isCurrentCard(plan, current, shown, yearly)
          const samePlanOtherInterval = plan.key === current.plan && plan.key !== 'free' && !isCurrent
          const price = shown === 'year' && plan.year ? plan.year : plan.month
          return (
            <Card key={plan.key} className={cx('flex flex-col p-5', isCurrent && 'border-ink ring-1 ring-ink')}>
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-semibold">{plan.name}</span>
                {isCurrent && (
                  <span className="rounded-full bg-lime px-2 py-0.5 text-[11px] font-semibold">
                    Current{plan.key !== 'free' ? ` · ${current.interval === 'year' ? 'yearly' : 'monthly'}` : ''}
                  </span>
                )}
              </div>
              <div className="mt-2 font-display text-[30px] font-bold tracking-[-0.04em]">
                {price}
                <span className="font-sans text-[13px] font-normal tracking-normal text-subtle">{shown === 'year' && plan.year ? '/year' : '/month'}</span>
              </div>
              {shown === 'year' && plan.savePercent !== null && <p className="mt-1 text-[12px] font-semibold text-green">Save {plan.savePercent}%</p>}
              <ul className="mt-3 flex flex-col gap-1.5 text-[13px] text-muted">
                {plan.perks.map((perk) => (
                  <li key={perk}>{perk}</li>
                ))}
              </ul>
              {isCurrent ? (
                <button type="button" disabled className={cx(buttonClass('secondary', 'sm'), 'mt-5')}>
                  Your plan
                </button>
              ) : plan.key === 'free' ? (
                canAct && hasBillingAccount ? (
                  <form action={openBillingPortal} className="mt-5 flex">
                    <button type="submit" className={cx(buttonClass('secondary', 'sm'), 'w-full')}>
                      Cancel in billing portal
                    </button>
                  </form>
                ) : (
                  <button type="button" disabled className={cx(buttonClass('secondary', 'sm'), 'mt-5')}>
                    Included
                  </button>
                )
              ) : (
                <form action={switchPlan} className="mt-5 flex">
                  <input type="hidden" name="plan" value={plan.key} />
                  <input type="hidden" name="interval" value={shown} />
                  <button type="submit" disabled={!canAct} className={cx(buttonClass('dark', 'sm'), 'w-full')}>
                    {samePlanOtherInterval ? `Switch to ${shown === 'year' ? 'yearly' : 'monthly'}` : `Switch to ${plan.name}`}
                  </button>
                </form>
              )}
            </Card>
          )
        })}
      </div>
    </>
  )
}
