import { describe, expect, it } from 'vitest'
import { escapeHtml, invitationEmail, passwordResetEmail, reauthEmail, verificationEmail } from '../src/templates'

describe('templates', () => {
  it('escapes HTML in every interpolated value', () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;')
    const email = invitationEmail({ inviterName: '<script>alert(1)</script>', workspaceName: 'Acme & Co', url: 'https://app.test/signup?email=a%40b.c&x=1' })
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;')
    expect(email.html).toContain('Acme &amp; Co')
    expect(email.html).toContain('href="https://app.test/signup?email=a%40b.c&amp;x=1"')
  })

  it('puts the action link in the plain-text part', () => {
    const email = verificationEmail({ name: 'Sam', url: 'https://app.test/api/auth/verify-email?token=t' })
    expect(email.subject).toBe('Confirm your email for Replyooo')
    expect(email.text).toContain('Confirm email: https://app.test/api/auth/verify-email?token=t')
    expect(email.text).toContain('Hi Sam,')
  })

  it('has a subject for every email', () => {
    expect(passwordResetEmail({ name: 'Sam', url: 'u' }).subject).toBe('Reset your Replyooo password')
    expect(invitationEmail({ inviterName: 'Maya', workspaceName: 'Acme', url: 'u' }).subject).toBe('Maya invited you to Acme on Replyooo')
    expect(reauthEmail({ username: 'maya.makes', platform: 'instagram', workspaceName: 'Acme', url: 'u' }).subject).toBe(
      'Reconnect @maya.makes to keep your automations running',
    )
  })
})
