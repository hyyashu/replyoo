'use client'

import { Languages } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useId, useState, useTransition } from 'react'
import { setDashboardLanguage } from '@/app/language-actions'
import { locales } from '@/i18n/locales'

export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const id = useId()
  const locale = useLocale()
  const t = useTranslations('common')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<'invalidLocale' | 'saveFailed' | null>(null)
  return (
    <div className={compact ? 'px-2 py-2' : 'max-w-sm'}>
      <label htmlFor={id} className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-muted">
        <Languages className="size-4 shrink-0" />
        {t('language')}
      </label>
      <select
        id={id}
        value={locale}
        disabled={pending}
        aria-busy={pending}
        onChange={(event) => {
          const value = event.target.value
          setError(null)
          startTransition(async () => {
            try {
              const result = await setDashboardLanguage(value)
              if (!result.ok) setError(result.code)
            } catch {
              setError('saveFailed')
            }
          })
        }}
        className="h-10 w-full rounded-xl border border-line bg-white px-3 text-[13.5px] text-ink disabled:opacity-50"
      >
        {Object.entries(locales).map(([code, entry]) => (
          <option key={code} value={code} lang={code}>
            {entry.name}
          </option>
        ))}
      </select>
      <p role="status" className="mt-1 text-[12px] text-brand">
        {error ? t(error) : ''}
      </p>
    </div>
  )
}
