import { decryptToken } from '@replyooo/db'
import { describe, expect, it } from 'vitest'
import { publishAutomation, seedAccount, seedContact, TOKEN_KEY, useDb } from './support'

describe('test harness', () => {
  it('seeds an account, contact and published automation against the migrated database', async () => {
    const db = useDb()
    const { account } = await seedAccount(db)
    expect(decryptToken(account.accessTokenEnc, TOKEN_KEY)).toBe('token-abc')
    const contact = await seedContact(db, account)
    expect(contact.lastCountedPeriod).toBeNull()
    const { automation, version } = await publishAutomation(db, account, {
      trigger: { type: 'any_dm' },
      start: 's1',
      steps: { s1: { type: 'send_message', text: 'hi' } },
    })
    expect(version.automationId).toBe(automation.id)
  })
})
