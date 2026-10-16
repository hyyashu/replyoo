import { useTranslations } from 'next-intl'

export default function AppLoading() {
  const tr = useTranslations('common')
  return (
    <div role="status" aria-live="polite" className="grid min-h-[60vh] place-items-center">
      <div className="size-6 animate-spin rounded-full border-2 border-line border-t-ink" />
      <span className="sr-only">{tr('loading')}</span>
    </div>
  )
}
