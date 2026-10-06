import { automations, subscriptions } from '@replyooo/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as data from '@/lib/data/automations'
import { db } from '@/lib/db'
import { createAccount, createWorkspace } from './support'

async function workspaceWithLive(count: number) {
  const { workspaceId } = await createWorkspace('Limits')
  const account = await createAccount(workspaceId, 'instagram')
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const automation = await data.createAutomation(workspaceId, account.id, 'comment_to_dm')
    if (!automation) throw new Error('createAutomation returned null')
    expect(await data.publishAutomation(workspaceId, automation.id)).toMatchObject({ ok: true })
    ids.push(automation.id)
  }
  return { workspaceId, account, ids }
}

async function draft(workspaceId: string, accountId: string) {
  const automation = await data.createAutomation(workspaceId, accountId, 'comment_to_dm')
  if (!automation) throw new Error('createAutomation returned null')
  return automation
}

const FREE_MESSAGE = 'Your Free plan allows 3 live automations. Pause one or upgrade in Settings → Billing.'

describe('live automation limit', () => {
  it('refuses a fourth live automation on Free and writes nothing', async () => {
    const { workspaceId, account } = await workspaceWithLive(3)
    const fourth = await draft(workspaceId, account.id)
    expect(await data.publishAutomation(workspaceId, fourth.id)).toEqual({ ok: false, errors: [FREE_MESSAGE] })
    const [row] = await db().select().from(automations).where(eq(automations.id, fourth.id))
    expect(row).toMatchObject({ status: 'draft', currentVersionId: null })
  })

  it('still republishes an automation that is already live', async () => {
    const { workspaceId, ids } = await workspaceWithLive(3)
    expect(await data.publishAutomation(workspaceId, ids[0] ?? '')).toEqual({ ok: true, version: 2 })
  })

  it('refuses to resume a paused automation past the limit', async () => {
    const { workspaceId, account, ids } = await workspaceWithLive(3)
    expect(await data.setAutomationStatus(workspaceId, ids[0] ?? '', 'paused')).toEqual({ ok: true })
    const replacement = await draft(workspaceId, account.id)
    expect(await data.publishAutomation(workspaceId, replacement.id)).toMatchObject({ ok: true })
    expect(await data.setAutomationStatus(workspaceId, ids[0] ?? '', 'active')).toEqual({ ok: false, error: FREE_MESSAGE })
  })

  it('has no live limit on Pro', async () => {
    const { workspaceId, account } = await workspaceWithLive(3)
    await db().insert(subscriptions).values({ workspaceId, plan: 'pro', status: 'active' })
    expect(await data.publishAutomation(workspaceId, (await draft(workspaceId, account.id)).id)).toMatchObject({ ok: true })
  })
})
