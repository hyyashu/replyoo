import { automations, subscriptions } from '@replyooo/db'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as data from '@/lib/data/automations'
import { db } from '@/lib/db'
import { lockWorkspaceLimits } from '@/lib/locks'
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

describe('limit lock ordering', () => {
  /** Holds the workspace's limit lock on its own connection until `release` is called. */
  function holdLimitLock(workspaceId: string) {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let locked!: () => void
    const acquired = new Promise<void>((resolve) => (locked = resolve))
    const done = db().transaction(async (tx) => {
      await lockWorkspaceLimits(tx, workspaceId)
      locked()
      await gate
    })
    return { acquired, release, done }
  }

  async function waitForLimitLockWaiter() {
    for (let i = 0; i < 100; i++) {
      const rows = await db().execute(sql`select 1 from pg_locks where locktype = 'advisory' and classid = 2 and objsubid = 2 and not granted`)
      if (rows.length > 0) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('no transaction waited for the limit lock')
  }

  async function rowLockable(id: string) {
    return db().transaction(async (tx) => {
      await tx.execute(sql`select id from automations where id = ${id} for update nowait`)
      return true
    })
  }

  it('publish and resume wait for the limit lock before locking the automation row', async () => {
    const { workspaceId, account } = await workspaceWithLive(0)
    const first = await draft(workspaceId, account.id)

    const holder = holdLimitLock(workspaceId)
    await holder.acquired
    const publishing = data.publishAutomation(workspaceId, first.id)
    try {
      await waitForLimitLockWaiter()
      expect(await rowLockable(first.id)).toBe(true)
    } finally {
      holder.release()
      await holder.done
    }
    expect(await publishing).toMatchObject({ ok: true })

    expect(await data.setAutomationStatus(workspaceId, first.id, 'paused')).toEqual({ ok: true })
    const second = holdLimitLock(workspaceId)
    await second.acquired
    const resuming = data.setAutomationStatus(workspaceId, first.id, 'active')
    try {
      await waitForLimitLockWaiter()
      expect(await rowLockable(first.id)).toBe(true)
    } finally {
      second.release()
      await second.done
    }
    expect(await resuming).toEqual({ ok: true })
  })
})
