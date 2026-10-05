'use server'

import { FlowDefinitionSchema } from '@replyooo/shared'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import * as data from '@/lib/data'
import { ACCOUNT_COOKIE, getCurrentAccount } from '@/lib/session'

export async function switchAccount(accountId: string) {
  ;(await cookies()).set(ACCOUNT_COOKIE, accountId, { path: '/', sameSite: 'lax', httpOnly: true })
  revalidatePath('/', 'layout')
}

export async function createAutomation(templateKey: string | null) {
  const { account } = await getCurrentAccount()
  const automation = await data.createAutomation(account.id, templateKey)
  redirect(`/automations/${automation.id}`)
}

export async function saveDraft(id: string, name: string, flow: unknown) {
  // Drafts may be incomplete, but they must still be well-formed JSON of the right shape.
  const parsed = FlowDefinitionSchema.safeParse(flow)
  if (!parsed.success) return { ok: false as const, error: 'Fix the highlighted fields before saving' }
  await data.saveDraft(id, { name, flow: parsed.data })
  revalidatePath('/automations')
  return { ok: true as const, savedAt: new Date().toISOString() }
}

export async function publishAutomation(id: string, name: string, flow: unknown) {
  const saved = await saveDraft(id, name, flow)
  if (!saved.ok) return { ok: false as const, errors: [saved.error] }
  const result = await data.publishAutomation(id)
  revalidatePath('/automations')
  revalidatePath(`/automations/${id}`)
  return result
}

export async function setAutomationStatus(id: string, status: 'active' | 'paused') {
  await data.setAutomationStatus(id, status)
  revalidatePath('/automations')
}

export async function deleteAutomation(id: string) {
  await data.deleteAutomation(id)
  revalidatePath('/automations')
}

export async function disconnectAccount(id: string) {
  await data.setAccountStatus(id, 'disconnected')
  revalidatePath('/', 'layout')
}

export async function inviteMember(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return
  await data.inviteMember(email)
  revalidatePath('/settings')
}

export async function removeMember(id: string) {
  await data.removeMember(id)
  revalidatePath('/settings')
}

export async function deleteWorkspace(formData: FormData) {
  const workspace = await data.getWorkspace()
  if (String(formData.get('confirm') ?? '').trim() !== workspace.name) return
  await data.deleteWorkspaceData()
  ;(await cookies()).delete(ACCOUNT_COOKIE)
  redirect('/')
}

/**
 * Stand-in for the Meta OAuth round trip (GET /api/meta/oauth/{platform}/start → callback),
 * which lands in Plan 3 together with token storage and webhook subscription.
 */
export async function connectAccount(platform: 'instagram' | 'facebook') {
  const account = await data.connectDemoAccount(platform)
  ;(await cookies()).set(ACCOUNT_COOKIE, account.id, { path: '/', sameSite: 'lax', httpOnly: true })
  redirect('/automations/new')
}

/** Placeholder until Better Auth is wired up (Plan 3): any submission lands in the dashboard. */
export async function signIn(_formData: FormData) {
  redirect('/home')
}

export async function signUp(_formData: FormData) {
  redirect('/connect')
}
