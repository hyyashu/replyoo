import { MailCheck } from 'lucide-react'
import { resendVerification } from '@/app/auth-actions'

export function VerifyEmailBanner({ email, sent }: { email: string; sent: boolean }) {
  return (
    <div className="flex items-center gap-2 border-b border-line bg-sky-soft px-10 py-2.5 text-[13.5px] text-ink">
      <MailCheck className="size-4" />
      Confirm your email. We sent a link to {email}.
      {sent ? (
        <span className="ml-auto text-muted">Sent. Check your inbox.</span>
      ) : (
        <form action={resendVerification} className="ml-auto">
          <button type="submit" className="font-semibold hover:underline">
            Resend link
          </button>
        </form>
      )}
    </div>
  )
}
