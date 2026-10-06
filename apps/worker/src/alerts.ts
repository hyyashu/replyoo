import { accountAlertContext } from '@replyooo/db'
import { reauthEmail } from '@replyooo/email'
import type { Deps } from './deps'
import { markReauthRequired } from './records'

/**
 * Spec §6: a revoked token flags the account (its automations stop starting runs) and emails the
 * workspace's owners and admins, once per transition. Email failures are logged, never thrown.
 */
export async function flagReauth(deps: Pick<Deps, 'db' | 'mailer' | 'appUrl' | 'log'>, accountId: string): Promise<void> {
  if (!(await markReauthRequired(deps.db, accountId))) return
  try {
    const context = await accountAlertContext(deps.db, accountId)
    if (!context) return
    const url = new URL(`/connect?platform=${context.platform}`, deps.appUrl).toString()
    const email = reauthEmail({ username: context.username, platform: context.platform, workspaceName: context.workspaceName, url })
    const results = await Promise.allSettled(context.recipients.map((to) => deps.mailer.send({ to, ...email })))
    for (const result of results) {
      if (result.status === 'rejected') deps.log.warn({ err: result.reason, accountId }, 'reauth alert email failed')
    }
  } catch (error) {
    deps.log.warn({ err: error, accountId }, 'reauth alert failed')
  }
}
