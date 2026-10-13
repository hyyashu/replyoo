import { useTranslations } from 'next-intl'
import { MailCheck } from 'lucide-react'
import { resendVerification } from '@/app/auth-actions'

export function VerifyEmailBanner({ email, sent }: { email: string; sent: boolean }) {
  const tr = useTranslations('shared')
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-sky-soft px-4 py-2.5 sm:px-10 text-[13.5px] text-ink">
      <MailCheck className="size-4" />
      {tr('verifyEmail', { email })}
      {sent ? (
        <span className="ml-auto text-muted">{tr('sent_check_your_inbox')}</span>
      ) : (
        <form action={resendVerification} className="ml-auto">
          <button type="submit" className="font-semibold hover:underline">
            {tr('resend_link')}{' '}
          </button>
        </form>
      )}
    </div>
  )
}
