import { connectedAccounts } from '@replyooo/db'
import { RecordingMailer } from '@replyooo/email/testing'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { flagReauth } from '../src/alerts'
import { createTestContext, seedAccount, seedMember } from './support'

async function statusOf(db: ReturnType<typeof createTestContext>['deps']['db'], id: string) {
  const [row] = await db.select({ status: connectedAccounts.status }).from(connectedAccounts).where(eq(connectedAccounts.id, id))
  return row?.status
}

describe('flagReauth', () => {
  it('flags the account and emails owners and admins once', async () => {
    const { deps, mailer } = createTestContext()
    const { workspace, account } = await seedAccount(deps.db)
    const owner = await seedMember(deps.db, workspace.id, 'owner')
    const admin = await seedMember(deps.db, workspace.id, 'admin')
    await seedMember(deps.db, workspace.id, 'member')

    await flagReauth(deps, account.id)
    await flagReauth(deps, account.id)

    expect(await statusOf(deps.db, account.id)).toBe('reauth_required')
    expect(mailer.sent.map((m) => m.to).sort()).toEqual([admin, owner].sort())
    expect(mailer.sent[0]?.subject).toBe('Reconnect @acme to keep your automations running')
    expect(mailer.sent[0]?.text).toContain('http://localhost:3000/connect?platform=instagram')
  })

  it('does not email about an account that was already flagged or disconnected', async () => {
    const { deps, mailer } = createTestContext()
    const { workspace, account } = await seedAccount(deps.db)
    await seedMember(deps.db, workspace.id, 'owner')
    await deps.db.update(connectedAccounts).set({ status: 'disconnected' }).where(eq(connectedAccounts.id, account.id))

    await flagReauth(deps, account.id)
    expect(await statusOf(deps.db, account.id)).toBe('disconnected')
    expect(mailer.sent).toEqual([])
  })

  it('still flags the account when email is down', async () => {
    const mailer = new RecordingMailer()
    mailer.failWith = new Error('smtp down')
    const { deps } = createTestContext({ mailer })
    const { workspace, account } = await seedAccount(deps.db)
    await seedMember(deps.db, workspace.id, 'owner')

    await expect(flagReauth(deps, account.id)).resolves.toBeUndefined()
    expect(await statusOf(deps.db, account.id)).toBe('reauth_required')
  })
})
