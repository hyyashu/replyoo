import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getAccount, getAutomation } from '@/lib/data'
import { requireWorkspace } from '@/lib/session'
import { Editor } from './editor'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('automations'))('edit_automation') }
}

export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { workspaceId } = await requireWorkspace()
  const automation = await getAutomation(workspaceId, id)
  if (!automation) notFound()
  const account = await getAccount(workspaceId, automation.accountId)
  if (!account) notFound()

  return <Editor key={automation.id} automation={automation} platform={account.platform} username={account.username} />
}
