import { z } from 'zod'

export const EMAIL_PROVIDERS = ['resend', 'smtp', 'log'] as const
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number]

export interface EmailConfig {
  from: string
  /** Tried in order; the next one is used when a send fails. */
  providers: EmailProvider[]
  resend?: { apiKey: string }
  smtp?: { host: string; port: number; secure: boolean; user?: string; pass?: string }
}

const blank = (value: unknown) => (value === '' ? undefined : value)
const optional = z.preprocess(blank, z.string().min(1).optional())

const EnvSchema = z.object({
  NODE_ENV: optional,
  EMAIL_PROVIDER: z.preprocess(blank, z.string().default('log')),
  EMAIL_FROM: optional,
  RESEND_API_KEY: optional,
  SMTP_HOST: optional,
  SMTP_PORT: z.preprocess(blank, z.coerce.number().int().positive().default(587)),
  SMTP_SECURE: z.preprocess(blank, z.enum(['true', 'false']).optional()),
  SMTP_USER: optional,
  SMTP_PASS: optional,
})

const isProvider = (value: string): value is EmailProvider => (EMAIL_PROVIDERS as readonly string[]).includes(value)

/** Reads the EMAIL_* variables shared by web and worker (see .env.example). */
export function parseEmailConfig(source: Record<string, string | undefined>): EmailConfig {
  const env = EnvSchema.parse(source)
  const names = env.EMAIL_PROVIDER.split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  const problems: string[] = []
  const providers: EmailProvider[] = []
  for (const name of names) {
    if (isProvider(name)) providers.push(name)
    else problems.push(`Unknown EMAIL_PROVIDER "${name}" (use resend, smtp or log)`)
  }
  if (names.length === 0) problems.push('EMAIL_PROVIDER is empty')
  if (providers.includes('resend') && !env.RESEND_API_KEY) problems.push('RESEND_API_KEY is required for EMAIL_PROVIDER=resend')
  if (providers.includes('smtp') && !env.SMTP_HOST) problems.push('SMTP_HOST is required for EMAIL_PROVIDER=smtp')
  if (providers.some((p) => p !== 'log') && !env.EMAIL_FROM) problems.push('EMAIL_FROM is required to send real email')
  if (env.NODE_ENV === 'production' && providers.includes('log')) {
    problems.push('EMAIL_PROVIDER=log only prints emails; use resend or smtp in production')
  }
  if (problems.length > 0) throw new Error(`Email is misconfigured: ${problems.join('; ')}`)

  const config: EmailConfig = { from: env.EMAIL_FROM ?? 'Replyooo <no-reply@localhost>', providers }
  if (env.RESEND_API_KEY) config.resend = { apiKey: env.RESEND_API_KEY }
  if (env.SMTP_HOST) {
    config.smtp = {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : env.SMTP_PORT === 465,
      ...(env.SMTP_USER ? { user: env.SMTP_USER } : {}),
      ...(env.SMTP_PASS ? { pass: env.SMTP_PASS } : {}),
    }
  }
  return config
}
