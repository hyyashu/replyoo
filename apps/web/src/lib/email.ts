import 'server-only'
import { createMailer, type EmailMessage, type Mailer, parseEmailConfig } from '@replyooo/email'

const store = globalThis as { __replyoooMailer?: Mailer }

/** Built from the EMAIL_* env on first use (packages/email/src/config.ts). */
export function mailer(): Mailer {
  store.__replyoooMailer ??= createMailer(parseEmailConfig(process.env))
  return store.__replyoooMailer
}

/** Test seam: install a mailer, or pass undefined to rebuild from env on next use. */
export function setMailer(next: Mailer | undefined): void {
  store.__replyoooMailer = next
}

/**
 * Sends without blocking the caller. Email is best-effort: an outage never fails sign-up, an invite or a
 * reset request, and not awaiting keeps response times the same whether or not an address has an account.
 */
export function deliver(message: EmailMessage, via?: Mailer): void {
  let target: Mailer
  try {
    target = via ?? mailer()
  } catch (error) {
    console.error('email is not configured', { subject: message.subject, error })
    return
  }
  target.send(message).catch((error: unknown) => {
    console.error('email delivery failed', { to: message.to, subject: message.subject, error })
  })
}
