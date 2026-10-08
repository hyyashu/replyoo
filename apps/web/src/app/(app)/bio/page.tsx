import type { Metadata } from 'next'
import { appUrl } from '@/lib/env'
import { bioOverview } from '@replyooo/db'
import { db } from '@/lib/db'
import { getAccountContext } from '@/lib/session'
import { getBioEditorData, toBioView } from '@/lib/data'
import { BioEditor } from './editor'

export const metadata: Metadata = { title: 'Bio page' }

export default async function BioPage() {
  const { workspace, account } = await getAccountContext()
  const { page, blocks } = await getBioEditorData(workspace.workspaceId, {
    slugSource: account?.username ?? workspace.workspaceName,
    displayName: account?.displayName || account?.username || workspace.workspaceName,
  })
  const view = toBioView(page, blocks)
  const stats = await bioOverview(db(), page.id)
  const publicUrl = appUrl(`/u/${page.slug}`)

  return (
    <BioEditor
      publicUrl={publicUrl}
      slug={page.slug}
      initial={{ displayName: view.displayName, bio: view.bio, theme: view.theme }}
      avatarUrl={view.avatarUrl}
      showBadge={view.showBadge}
      initialBlocks={view.blocks}
      stats={stats}
    />
  )
}
