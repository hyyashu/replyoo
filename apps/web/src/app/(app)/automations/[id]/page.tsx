import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getAccount, getAutomation } from '@/lib/data'
import { requireWorkspace } from '@/lib/session'
import { Editor } from './editor'

export const metadata: Metadata = { title: 'Edit automation' }

export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const automation = await getAutomation(id)
  if (!automation) notFound()
  const { workspaceId } = await requireWorkspace()
  const account = await getAccount(workspaceId, automation.accountId)
  if (!account) notFound()

  return <Editor key={automation.id} automation={automation} platform={account.platform} username={account.username} />
}
