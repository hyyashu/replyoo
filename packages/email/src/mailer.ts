import nodemailer from 'nodemailer'
import type { EmailConfig, EmailProvider } from './config'

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>
}

export class EmailError extends Error {
  override name = 'EmailError'
}

const RESEND_URL = 'https://api.resend.com/emails'
const TIMEOUT_MS = 10_000

export function resendMailer(from: string, apiKey: string): Mailer {
  return {
    async send(message) {
      let response: Response
      try {
        response = await fetch(RESEND_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [message.to], subject: message.subject, html: message.html, text: message.text }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
      } catch (cause) {
        throw new EmailError(`Resend request failed: ${(cause as Error).message}`)
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string }
        throw new EmailError(`Resend rejected the email (${response.status}): ${body.message ?? response.statusText}`)
      }
    },
  }
}

export function smtpMailer(from: string, smtp: NonNullable<EmailConfig['smtp']>): Mailer {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.pass ?? '' } } : {}),
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  })
  return {
    async send(message) {
      try {
        await transport.sendMail({ from, to: message.to, subject: message.subject, html: message.html, text: message.text })
      } catch (cause) {
        throw new EmailError(`SMTP send failed: ${(cause as Error).message}`)
      }
    },
  }
}

/** Local development: prints the email (links included) instead of sending it. */
export function logMailer(print: (line: string) => void = (line) => console.info(line)): Mailer {
  return {
    async send(message) {
      print(`[email] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`)
    },
  }
}

/** Tries each mailer in order and stops at the first that accepts the message. */
export function failoverMailer(mailers: Mailer[]): Mailer {
  return {
    async send(message) {
      const errors: string[] = []
      for (const mailer of mailers) {
        try {
          await mailer.send(message)
          return
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error))
        }
      }
      throw new EmailError(`Every email provider failed: ${errors.join(' | ')}`)
    },
  }
}

function build(provider: EmailProvider, config: EmailConfig, print?: (line: string) => void): Mailer {
  switch (provider) {
    case 'resend':
      if (!config.resend) throw new Error('EMAIL_PROVIDER includes resend but RESEND_API_KEY is not set')
      return resendMailer(config.from, config.resend.apiKey)
    case 'smtp':
      if (!config.smtp) throw new Error('EMAIL_PROVIDER includes smtp but SMTP_HOST is not set')
      return smtpMailer(config.from, config.smtp)
    case 'log':
      return logMailer(print)
  }
}

export function createMailer(config: EmailConfig, options: { print?: (line: string) => void } = {}): Mailer {
  const mailers = config.providers.map((provider) => build(provider, config, options.print))
  const [only] = mailers
  return mailers.length === 1 && only ? only : failoverMailer(mailers)
}
