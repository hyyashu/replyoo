import type { EmailMessage, Mailer } from './mailer'

/** Captures messages instead of sending them. `send` records synchronously, before its first await. */
export class RecordingMailer implements Mailer {
  sent: EmailMessage[] = []
  failWith: Error | null = null

  async send(message: EmailMessage): Promise<void> {
    if (this.failWith) throw this.failWith
    this.sent.push(message)
  }

  clear(): void {
    this.sent = []
  }
}
