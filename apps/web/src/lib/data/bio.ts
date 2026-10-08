import 'server-only'
import { getBioPageBySlug, getBioPageByWorkspace, insertBioPage, listBioBlocks, type BioBlockRow, type BioPageRow } from '@replyooo/db'
import { slugCandidate, slugify } from '../bio'
import { db } from '../db'
import type { BioViewData } from '@/components/bio-page-view'

export function toBioView(page: BioPageRow, blocks: BioBlockRow[]): BioViewData {
  return {
    displayName: page.displayName,
    bio: page.bio,
    avatarUrl: page.avatarUrl,
    theme: page.theme,
    showBadge: page.showBadge,
    blocks: blocks.map((b) => ({ id: b.id, type: b.type, label: b.config.label, url: b.config.url, hidden: b.hidden })),
  }
}

/** The workspace's page, created on first call with a unique slug derived from `slugSource`. */
export async function ensureBioPage(
  workspaceId: string,
  defaults: { slugSource: string; displayName: string },
): Promise<BioPageRow> {
  const existing = await getBioPageByWorkspace(db(), workspaceId)
  if (existing) return existing
  const base = slugify(defaults.slugSource)
  for (let attempt = 0; attempt < 40; attempt++) {
    const created = await insertBioPage(db(), {
      workspaceId,
      slug: slugCandidate(base, attempt),
      displayName: defaults.displayName.slice(0, 60),
    })
    if (created) return created
    // Either the slug is taken or another request just created this workspace's page.
    const raced = await getBioPageByWorkspace(db(), workspaceId)
    if (raced) return raced
  }
  throw new Error('Could not pick a bio page address')
}

/** Public lookup: null when the slug is unknown. */
export async function getPublicBioPage(slug: string) {
  const page = await getBioPageBySlug(db(), slug)
  if (!page) return null
  return { page, blocks: await listBioBlocks(db(), page.id) }
}

export async function getBioEditorData(workspaceId: string, defaults: { slugSource: string; displayName: string }) {
  const page = await ensureBioPage(workspaceId, defaults)
  return { page, blocks: await listBioBlocks(db(), page.id) }
}
