export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

interface Action {
  label: string
  url: string
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function html(heading: string, paragraphs: string[], action: Action, footer: string): string {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#3b3833">${escapeHtml(p)}</p>`)
    .join('')
  return `<!doctype html><html><body style="margin:0;background:#f6f3ee;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px"><tr><td style="padding:32px">
<div style="font-size:20px;font-weight:700;color:#141310;margin-bottom:24px">Replyooo</div>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;color:#141310">${escapeHtml(heading)}</h1>
${body}
<a href="${escapeHtml(action.url)}" style="display:inline-block;background:#ff4f1f;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:999px">${escapeHtml(action.label)}</a>
<p style="margin:24px 0 0;font-size:12.5px;line-height:1.5;color:#8a857c">${escapeHtml(footer)}</p>
</td></tr></table></td></tr></table></body></html>`
}

function text(heading: string, paragraphs: string[], action: Action, footer: string): string {
  return [heading, '', ...paragraphs.flatMap((p) => [p, '']), `${action.label}: ${action.url}`, '', footer].join('\n')
}

function render(subject: string, heading: string, paragraphs: string[], action: Action, footer: string): RenderedEmail {
  return { subject, html: html(heading, paragraphs, action, footer), text: text(heading, paragraphs, action, footer) }
}

export function verificationEmail({ name, url }: { name: string; url: string }): RenderedEmail {
  return render(
    'Confirm your email for Replyooo',
    'Confirm your email',
    [`Hi ${name},`, 'Confirm this address so teammates can invite you and we can reach you about your connected accounts.'],
    { label: 'Confirm email', url },
    'The link works for one hour. If you didn’t sign up for Replyooo, ignore this email.',
  )
}

export function passwordResetEmail({ name, url }: { name: string; url: string }): RenderedEmail {
  return render(
    'Reset your Replyooo password',
    'Reset your password',
    [`Hi ${name},`, 'Someone asked to reset the password for this Replyooo account. Choose a new one with the button below.'],
    { label: 'Choose a new password', url },
    'The link works for one hour. If you didn’t ask for this, ignore this email and your password stays the same.',
  )
}

export function invitationEmail({
  inviterName,
  workspaceName,
  url,
}: {
  inviterName: string
  workspaceName: string
  url: string
}): RenderedEmail {
  return render(
    `${inviterName} invited you to ${workspaceName} on Replyooo`,
    `Join ${workspaceName} on Replyooo`,
    [
      `${inviterName} invited you to the ${workspaceName} workspace on Replyooo.`,
      'Sign up or log in with this email address and confirm it. You’re added to the workspace automatically.',
    ],
    { label: 'Join the workspace', url },
    'If you weren’t expecting this, you can ignore this email.',
  )
}

export function reauthEmail({
  username,
  platform,
  workspaceName,
  url,
}: {
  username: string
  platform: 'instagram' | 'facebook'
  workspaceName: string
  url: string
}): RenderedEmail {
  const where = platform === 'instagram' ? 'Instagram account' : 'Facebook Page'
  return render(
    `Reconnect @${username} to keep your automations running`,
    'Meta needs you to reconnect',
    [
      `Meta revoked Replyooo’s access to the ${where} @${username} in ${workspaceName}.`,
      'Automations on this account are paused until you reconnect. It takes about a minute.',
    ],
    { label: 'Reconnect the account', url },
    'You’re getting this because you’re an owner or admin of this workspace.',
  )
}
