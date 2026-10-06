'use server'

import { FlowDefinitionSchema } from '@replyooo/shared'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import * as data from '@/lib/data'
import { ACCOUNT_COOKIE, COOKIE_OPTIONS, getCurrentAccount, requireWorkspace } from '@/lib/session'

export async function switchAccount(accountId: string) {
  const { workspaceId } = await requireWorkspace()
  if (!(await data.getAccount(workspaceId, accountId))) return
  ;(await cookies()).set(ACCOUNT_COOKIE, accountId, COOKIE_OPTIONS)
  revalidatePath('/', 'layout')
}

export async function createAutomation(templateKey: string | null) {
  const { workspace, account } = await getCurrentAccount()
  const automation = await data.createAutomation(workspace.workspaceId, account.id, templateKey)
  if (!automation) redirect('/connect')
  redirect(`/automations/${automation.id}`)
}

export async function saveDraft(id: string, name: string, flow: unknown) {
  const { workspaceId } = await requireWorkspace()
  // Drafts may be incomplete, but they must still be well-formed JSON of the right shape.
  const parsed = FlowDefinitionSchema.safeParse(flow)
  if (!parsed.success) return { ok: false as const, error: 'Fix the highlighted fields before saving' }
  if (!(await data.saveDraft(workspaceId, id, { name, flow: parsed.data }))) {
    return { ok: false as const, error: 'This automation no longer exists' }
  }
  revalidatePath('/automations')
  return { ok: true as const, savedAt: new Date().toISOString() }
}

export async function publishAutomation(id: string, name: string, flow: unknown): Promise<data.PublishResult> {
  const saved = await saveDraft(id, name, flow)
  if (!saved.ok) return { ok: false, errors: [saved.error] }
  const { workspaceId } = await requireWorkspace()
  const result = await data.publishAutomation(workspaceId, id)
  revalidatePath('/automations')
  revalidatePath(`/automations/${id}`)
  return result
}

export async function setAutomationStatus(id: string, status: 'active' | 'paused'): Promise<data.StatusResult> {
  const { workspaceId } = await requireWorkspace()
  const result = await data.setAutomationStatus(workspaceId, id, status)
  revalidatePath('/automations')
  return result
}

export async function deleteAutomation(id: string) {
  const { workspaceId } = await requireWorkspace()
  await data.deleteAutomation(workspaceId, id)
  revalidatePath('/automations')
}

export async function disconnectAccount(id: string) {
  const { workspaceId } = await requireWorkspace()
  await data.disconnectAccount(workspaceId, id)
  revalidatePath('/', 'layout')
}

export async function inviteMember(formData: FormData) {
  await requireWorkspace()
  const email = String(formData.get('email') ?? '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return
  await data.inviteMember(email)
  revalidatePath('/settings')
}

export async function removeMember(id: string) {
  await requireWorkspace()
  await data.removeMember(id)
  revalidatePath('/settings')
}

export async function deleteWorkspace(formData: FormData) {
  await requireWorkspace()
  const workspace = await data.getWorkspace()
  if (String(formData.get('confirm') ?? '').trim() !== workspace.name) return
  await data.deleteWorkspaceData()
  ;(await cookies()).delete(ACCOUNT_COOKIE)
  redirect('/')
}
