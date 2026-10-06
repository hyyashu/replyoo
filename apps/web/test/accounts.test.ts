import { describe, expect, it } from 'vitest'
import { disconnectAccount, getAccount, listAccounts } from '@/lib/data/accounts'
import { createAccount, createWorkspace } from './support'

describe('accounts are scoped to their workspace', () => {
  it('lists only the workspace’s connected accounts, oldest first', async () => {
    const a = await createWorkspace('A')
    const b = await createWorkspace('B')
    const first = await createAccount(a.workspaceId, 'instagram')
    const second = await createAccount(a.workspaceId, 'facebook', { followersCount: null })
    await createAccount(a.workspaceId, 'instagram', { status: 'disconnected' })
    await createAccount(b.workspaceId, 'instagram')

    const accounts = await listAccounts(a.workspaceId)
    expect(accounts.map((x) => x.id)).toEqual([first.id, second.id])
    expect(accounts[1]).toMatchObject({ platform: 'facebook', followers: null, status: 'active' })
  })

  it('treats another workspace’s account or a malformed id as missing', async () => {
    const a = await createWorkspace('A')
    const b = await createWorkspace('B')
    const account = await createAccount(a.workspaceId)
    expect(await getAccount(b.workspaceId, account.id)).toBeNull()
    expect(await getAccount(a.workspaceId, 'acc_ig')).toBeNull()

    await disconnectAccount(b.workspaceId, account.id)
    expect(await getAccount(a.workspaceId, account.id)).toMatchObject({ status: 'active' })

    await disconnectAccount(a.workspaceId, account.id)
    expect(await listAccounts(a.workspaceId)).toEqual([])
  })
})
