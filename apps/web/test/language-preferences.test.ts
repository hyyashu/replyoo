import { authUsers } from '@replyooo/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { getUserLocale, saveUserLocale } from '@/lib/data/preferences'
import { db } from '@/lib/db'
import { createUser } from './support'

describe('personal language preference', () => {
  it('leaves new users available for browser negotiation', async () => {
    const user = await createUser()
    expect(await getUserLocale(user.id)).toBeNull()
  })
  it('persists language without changing a teammate', async () => {
    const a = await createUser()
    const b = await createUser()
    await saveUserLocale(a.id, 'es')
    expect(await getUserLocale(a.id)).toBe('es')
    expect(await getUserLocale(b.id)).toBeNull()
    await saveUserLocale(a.id, 'en')
    expect(await getUserLocale(a.id)).toBe('en')
  })
  it('rejects invalid language input and does not recreate a deleted user', async () => {
    const user = await createUser()
    await expect(saveUserLocale(user.id, '../es' as 'es')).rejects.toThrow('Unsupported locale')
    expect(await getUserLocale(user.id)).toBeNull()
    await db().delete(authUsers).where(eq(authUsers.id, user.id))
    await expect(saveUserLocale(user.id, 'es')).rejects.toThrow('User no longer exists')
    expect(await getUserLocale(user.id)).toBeNull()
  })
})
