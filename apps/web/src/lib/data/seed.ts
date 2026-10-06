import type { Member, Subscription, Workspace } from './types'

const DAY = 86_400_000

/** Remaining demo data until members and billing move to Postgres (Task 9). */
export function seed() {
  const workspace: Workspace = { id: 'ws_1', name: 'Maya Makes', user: { name: 'Maya Lopez', email: 'maya@mayamakes.co' } }
  const members: Member[] = [{ id: 'mem_1', name: 'Maya Lopez', email: 'maya@mayamakes.co', role: 'owner' }]
  const subscription: Subscription = {
    plan: 'pro',
    contactsReached: 0,
    contactsLimit: 5_000,
    periodEnd: new Date(Date.now() + 18 * DAY).toISOString(),
  }
  return { workspace, members, subscription }
}
