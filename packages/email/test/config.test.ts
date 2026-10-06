import { describe, expect, it } from 'vitest'
import { parseEmailConfig } from '../src/config'

describe('parseEmailConfig', () => {
  it('prints to the console when nothing is configured', () => {
    expect(parseEmailConfig({})).toEqual({ from: 'Replyooo <no-reply@localhost>', providers: ['log'] })
  })

  it('reads Resend', () => {
    expect(parseEmailConfig({ EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'Replyooo <hi@replyooo.test>', RESEND_API_KEY: 're_123' })).toEqual({
      from: 'Replyooo <hi@replyooo.test>',
      providers: ['resend'],
      resend: { apiKey: 're_123' },
    })
  })

  it('reads an ordered failover list with SMTP defaults', () => {
    expect(
      parseEmailConfig({
        EMAIL_PROVIDER: 'resend, smtp',
        EMAIL_FROM: 'hi@replyooo.test',
        RESEND_API_KEY: 're_123',
        SMTP_HOST: 'smtp.test',
        SMTP_USER: 'mailer',
        SMTP_PASS: 'secret',
      }),
    ).toEqual({
      from: 'hi@replyooo.test',
      providers: ['resend', 'smtp'],
      resend: { apiKey: 're_123' },
      smtp: { host: 'smtp.test', port: 587, secure: false, user: 'mailer', pass: 'secret' },
    })
  })

  it('uses implicit TLS on port 465 unless SMTP_SECURE says otherwise', () => {
    const base = { EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'hi@replyooo.test', SMTP_HOST: 'smtp.test' }
    expect(parseEmailConfig({ ...base, SMTP_PORT: '465' }).smtp).toEqual({ host: 'smtp.test', port: 465, secure: true })
    expect(parseEmailConfig({ ...base, SMTP_PORT: '465', SMTP_SECURE: 'false' }).smtp?.secure).toBe(false)
    expect(parseEmailConfig({ ...base, SMTP_PORT: '' }).smtp?.port).toBe(587)
  })

  it('names every missing setting', () => {
    expect(() => parseEmailConfig({ EMAIL_PROVIDER: 'resend,smtp' })).toThrow(
      'Email is misconfigured: RESEND_API_KEY is required for EMAIL_PROVIDER=resend; SMTP_HOST is required for EMAIL_PROVIDER=smtp; EMAIL_FROM is required to send real email',
    )
  })

  it('rejects unknown providers and log in production', () => {
    expect(() => parseEmailConfig({ EMAIL_PROVIDER: 'sendgrid' })).toThrow('Unknown EMAIL_PROVIDER "sendgrid"')
    expect(() => parseEmailConfig({ NODE_ENV: 'production' })).toThrow('EMAIL_PROVIDER=log only prints emails')
  })
})
