'use server'

import { FlowDefinitionSchema } from '@replyooo/shared'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import * as data from '@/lib/data'
import { db } from '@/lib/db'
import { ACCOUNT_COOKIE, COOKIE_OPTIONS, WORKSPACE_COOKIE, getCurrentAccount, requireWorkspace } from '@/lib/session'
import { canManage, listWorkspaces } from '@/lib/workspaces'

async function requireManager() {
  const workspace = await requireWorkspace()
  if (!canManage(workspace.role)) throw new Error('Only owners and admins can do that')
  return workspace
}

export async function switchAccount(accountId: string) {
  const { workspaceId } = await requireWorkspace()
  if (!(await data.getAccount(workspaceId, accountId))) return
  ;(await cookies()).set(ACCOUNT_COOKIE, accountId, COOKIE_OPTIONS)
  revalidatePath('/', 'layout')
}

export async function switchWorkspace(workspaceId: string) {
  const { user } = await requireWorkspace()
  if (!(await listWorkspaces(db(), user.id)).some((w) => w.id === workspaceId)) return
  const jar = await cookies()
  jar.set(WORKSPACE_COOKIE, workspaceId, COOKIE_OPTIONS)
  jar.delete(ACCOUNT_COOKIE)
  redirect('/home')
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
  const { workspaceId } = await requireWorkspace()
  const saved = await saveDraft(id, name, flow)
  if (!saved.ok) return { ok: false, errors: [saved.error] }
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
  const { workspaceId } = await requireManager()
  await data.disconnectAccount(workspaceId, id)
  revalidatePath('/', 'layout')
}

export async function inviteMember(formData: FormData) {
  const workspace = await requireManager()
  const result = await data.inviteMember(workspace.workspaceId, workspace.user.id, String(formData.get('email') ?? ''))
  revalidatePath('/settings')
  redirect(`/settings?invite=${result}#members`)
}

export async function revokeInvitation(id: string) {
  const { workspaceId } = await requireManager()
  await data.revokeInvitation(workspaceId, id)
  revalidatePath('/settings')
}

export async function removeMember(id: string) {
  const { workspaceId } = await requireManager()
  await data.removeMember(workspaceId, id)
  revalidatePath('/settings')
}

export async function deleteWorkspace(formData: FormData) {
  const workspace = await requireWorkspace()
  if (workspace.role !== 'owner') return
  if (String(formData.get('confirm') ?? '').trim() !== workspace.workspaceName) return
  await data.deleteWorkspace(workspace.workspaceId)
  const jar = await cookies()
  jar.delete(ACCOUNT_COOKIE)
  jar.delete(WORKSPACE_COOKIE)
  redirect('/')
}
