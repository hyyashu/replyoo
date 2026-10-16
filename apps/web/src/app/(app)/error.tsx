'use client'

import { TriangleAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'
import { Button } from '@/components/ui'

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const tr = useTranslations('common')
  useEffect(() => console.error(error), [error])
  return (
    <div role="alert" className="grid min-h-[60vh] place-items-center px-6 text-center">
      <div>
        <TriangleAlert className="mx-auto size-6 text-subtle" />
        <h1 className="mt-4 font-display text-[26px] font-bold tracking-[-0.03em]">{tr('errorTitle')}</h1>
        <p className="mt-2 text-[15px] text-muted">{tr('genericError')}</p>
        <Button className="mt-6" onClick={reset}>
          {tr('tryAgain')}
        </Button>
      </div>
    </div>
  )
}
