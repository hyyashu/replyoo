'use client'

import { useId, useState } from 'react'
import { Segmented } from '@/components/tools/shared'
import { cx, formatNumber } from '@/components/ui'
import { TEXT_LIMITS, textStats, type TextLimitKey } from '@/lib/tools/text-limits'

export function TextLimitsTool() {
  const id = useId()
  const [kind, setKind] = useState<TextLimitKey>('caption')
  const [text, setText] = useState('')
  const stats = textStats(text)
  const { label, max } = TEXT_LIMITS[kind]
  const left = max - stats.characters

  return (
    <div className="flex flex-col gap-4">
      <Segmented
        label="What are you writing?"
        value={kind}
        onChange={setKind}
        options={(Object.keys(TEXT_LIMITS) as TextLimitKey[]).map((key) => ({ value: key, label: TEXT_LIMITS[key].label }))}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-[13px] font-semibold">
          {label} <span className="font-normal text-subtle">· up to {formatNumber(max)} characters</span>
        </label>
        <textarea
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={kind === 'bio' ? 4 : 8}
          placeholder="Paste or type here"
          className="w-full rounded-xl border border-line bg-white px-3.5 py-3 text-[14px] leading-relaxed outline-none transition-colors placeholder:text-faint focus:border-ink"
        />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2" aria-live="polite">
        <span className={cx('text-[15px] font-semibold tabular-nums', left < 0 ? 'text-brand' : 'text-ink')}>
          {formatNumber(stats.characters)} / {formatNumber(max)}
        </span>
        <span className={cx('text-[13px]', left < 0 ? 'font-semibold text-brand' : 'text-subtle')}>
          {left < 0 ? `${formatNumber(-left)} over the limit` : `${formatNumber(left)} left`}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            ['Words', stats.words],
            ['Hashtags', stats.hashtags],
            ['Mentions', stats.mentions],
            ['Lines', stats.lines],
          ] as const
        ).map(([name, value]) => (
          <div key={name} className="rounded-2xl bg-sand px-3.5 py-2.5">
            <dt className="text-[12px] text-subtle">{name}</dt>
            <dd className="text-[18px] font-semibold tabular-nums">{formatNumber(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
