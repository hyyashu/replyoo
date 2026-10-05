import { flowRuns } from '@replyooo/db'
import type { Effect } from '@replyooo/engine'
import { newRunState } from '@replyooo/engine'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { applyContactEffects, credentials, endRun, runColumns, toRunState } from '../src/records'
import { NOW, publishAutomation, seedAccount, seedContact, TOKEN_KEY, useDb } from './support'

describe('record helpers', () => {
  it('round-trips run state through a row', async () => {
    const db = useDb()
    const { account } = await seedAccount(db)
    const contact = await seedContact(db, account)
    const { automation, version } = await publishAutomation(db, account, {
      trigger: { type: 'any_dm' },
      start: 's1',
      steps: { s1: { type: 'delay', minutes: 5 } },
    })
    const state = {
      ...newRunState(),
      status: 'waiting' as const,
      currentStepId: 's1',
      wait: { kind: 'reply' as const, attempts: 1 },
      waitUntil: new Date(NOW.getTime() + 60_000),
      vars: { email: 'a@b.co' },
      stateVersion: 3,
      outbound: 'blocked' as const,
      commentId: 'c1',
    }
    const [row] = await db
      .insert(flowRuns)
      .values({
        automationId: automation.id,
        automationVersionId: version.id,
        contactId: contact.id,
        connectedAccountId: account.id,
        ...runColumns(state, NOW),
      })
      .returning()
    expect(toRunState(row!)).toEqual(state)
    expect(row!.completedAt).toBeNull()

    const done = runColumns({ ...state, status: 'completed', wait: null, waitUntil: null }, NOW)
    expect(done.completedAt).toEqual(NOW)

    await endRun(db, row!.id, 'expired', 'window_closed', NOW)
    const [ended] = await db.select().from(flowRuns).where(eq(flowRuns.id, row!.id))
    expect(ended).toMatchObject({ status: 'expired', error: 'window_closed', wait: null, stateVersion: 4 })

    await endRun(db, row!.id, 'failed', 'again', NOW)
    const [unchanged] = await db.select().from(flowRuns).where(eq(flowRuns.id, row!.id))
    expect(unchanged).toMatchObject({ status: 'expired', stateVersion: 4 })
  })

  it('applies contact patches in order', () => {
    const contact = {
      email: null,
      phone: null,
      tags: ['old', 'vip'],
      fields: { city: 'Pune' },
    } as unknown as Parameters<typeof applyContactEffects>[0]
    const effects: Effect[] = [
      { type: 'send', message: { text: 'x' } },
      { type: 'update_contact', patch: { email: 'a@b.co', fields: { size: 'M' } } },
      { type: 'update_contact', patch: { addTags: ['lead', 'vip'], removeTags: ['old'] } },
    ]
    expect(applyContactEffects(contact, effects)).toEqual({
      email: 'a@b.co',
      phone: null,
      tags: ['vip', 'lead'],
      fields: { city: 'Pune', size: 'M' },
    })
    expect(applyContactEffects(contact, [{ type: 'check_follow' }])).toBeNull()
  })

  it('decrypts account credentials', async () => {
    const { account } = await seedAccount(useDb())
    expect(credentials(account, TOKEN_KEY)).toEqual({ externalId: account.externalId, accessToken: 'token-abc' })
  })
})
