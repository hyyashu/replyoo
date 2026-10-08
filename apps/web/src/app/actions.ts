'use server'

import { DraftFlowSchema } from '@replyooo/shared'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { billingCustomer, startPlanChange } from '@/lib/billing/checkout'
import { createPortalSession, dodoConfig, DodoError } from '@/lib/billing/dodo'
import * as data from '@/lib/data'
import { db } from '@/lib/db'
import { appUrl } from '@/lib/env'
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

type PublishActionResult = data.PublishResult | { ok: false; errors: string[]; conflict?: true; saved?: true }

const MAX_DRAFT_BYTES = 200_000
const CONFLICT_MESSAGE = 'This automation was changed in another tab. Reload to get the latest version.'

/** `base` is the draft this tab last saw; if someone else saved since, the write is refused. */
export async function saveDraft(id: string, name: string, flow: unknown, base?: unknown) {
  const { workspaceId } = await requireWorkspace()
  // Drafts may be incomplete (publishing checks them strictly), but they must be the right shape and a sane size.
  const parsed = DraftFlowSchema.safeParse(flow)
  if (!parsed.success || JSON.stringify(flow).length > MAX_DRAFT_BYTES) {
    return { ok: false as const, error: 'Fix the highlighted fields before saving' }
  }
  const result = await data.saveDraft(workspaceId, id, { name, flow: parsed.data }, base)
  if (result === 'conflict') return { ok: false as const, conflict: true as const, error: CONFLICT_MESSAGE }
  if (result === 'missing') return { ok: false as const, error: 'This automation no longer exists' }
  revalidatePath('/automations')
  return { ok: true as const, savedAt: new Date().toISOString() }
}

export async function publishAutomation(
  id: string,
  name: string,
  flow: unknown,
  base?: unknown,
): Promise<PublishActionResult> {
  const { workspaceId } = await requireWorkspace()
  const saved = await saveDraft(id, name, flow, base)
  if (!saved.ok) return { ok: false, errors: [saved.error], ...('conflict' in saved && { conflict: true as const }) }
  const result = await data.publishAutomation(workspaceId, id)
  revalidatePath('/automations')
  revalidatePath(`/automations/${id}`)
  // `saved` tells the editor the draft was stored even though the publish checks failed.
  return result.ok ? result : { ...result, saved: true }
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
  const result = await data.inviteMember(workspace.workspaceId, workspace.user, String(formData.get('email') ?? ''))
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

export async function switchPlan(formData: FormData) {
  const workspace = await requireManager()
  const plan = String(formData.get('plan') ?? '')
  const config = dodoConfig()
  if (!config || (plan !== 'pro' && plan !== 'business')) redirect('/settings?billing=unavailable#billing')
  let destination: string
  try {
    destination = await startPlanChange(config, workspace, plan)
  } catch (error) {
    if (!(error instanceof DodoError)) throw error
    console.error('dodo plan change failed', error)
    destination = '/settings?billing=error#billing'
  }
  redirect(destination)
}

export async function openBillingPortal() {
  const { workspaceId } = await requireManager()
  const config = dodoConfig()
  const customerId = await billingCustomer(workspaceId)
  if (!config || !customerId) redirect('/settings?billing=unavailable#billing')
  let destination: string
  try {
    destination = await createPortalSession(config, customerId, appUrl('/settings#billing'))
  } catch (error) {
    if (!(error instanceof DodoError)) throw error
    console.error('dodo portal failed', error)
    destination = '/settings?billing=error#billing'
  }
  redirect(destination)
}
