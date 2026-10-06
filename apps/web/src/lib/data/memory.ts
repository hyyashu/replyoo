import 'server-only'
import { seed } from './seed'
import type { Member } from './types'

/** Remaining in-memory workspace data; Task 9 replaces it with workspace.ts. */
const store: ReturnType<typeof seed> = ((globalThis as { __replyoooStore?: ReturnType<typeof seed> }).__replyoooStore ??=
  seed())

const clone = <T>(value: T): T => structuredClone(value)

export async function getWorkspace() {
  return clone(store.workspace)
}

export async function listMembers() {
  return clone(store.members)
}

export async function inviteMember(email: string): Promise<Member> {
  const member: Member = { id: `mem_${crypto.randomUUID().slice(0, 8)}`, name: email.split('@')[0] ?? email, email, role: 'member' }
  store.members.push(member)
  return clone(member)
}

export async function removeMember(id: string) {
  store.members = store.members.filter((m) => m.id !== id || m.role === 'owner')
}

export async function getSubscription() {
  return clone(store.subscription)
}

export async function deleteWorkspaceData() {
  store.members = store.members.filter((m) => m.role === 'owner')
}
