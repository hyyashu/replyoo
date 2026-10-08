'use server'

import {
  addBioBlock,
  bioBlockDaily,
  deleteBioBlock,
  getBioPageByWorkspace,
  moveBioBlock as moveBlockRow,
  updateBioBlock,
  updateBioPage,
  listBioBlocks,
} from '@replyooo/db'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { BIO_MAX, LABEL_MAX, MAX_BLOCKS, NAME_MAX, THEME_IDS, normalizeHttpUrl } from '@/lib/bio'
import { isUuid } from '@/lib/data/ids'
import { db } from '@/lib/db'
import { requireWorkspace } from '@/lib/session'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const DetailsSchema = z.object({
  displayName: z.string().trim().min(1, 'Add a display name').max(NAME_MAX, `Name can be up to ${NAME_MAX} characters`),
  bio: z.string().trim().max(BIO_MAX, `Bio can be up to ${BIO_MAX} characters`),
  theme: z.enum(THEME_IDS),
})

const LabelSchema = z.string().trim().min(1, 'Add a title').max(LABEL_MAX, `Titles can be up to ${LABEL_MAX} characters`)

async function requirePage() {
  const { workspaceId } = await requireWorkspace()
  const page = await getBioPageByWorkspace(db(), workspaceId)
  if (!page) throw new Error('Open the Bio page first')
  return page
}

function refresh(slug: string) {
  revalidatePath('/bio')
  revalidatePath(`/u/${slug}`)
}

export async function saveBioDetails(input: unknown): Promise<Result<{ displayName: string; bio: string; theme: string }>> {
  const parsed = DetailsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the highlighted fields' }
  const page = await requirePage()
  await updateBioPage(db(), page.workspaceId, parsed.data)
  refresh(page.slug)
  return { ok: true, ...parsed.data }
}

// Checks a block's title (and, for links, its address) the same way for new and existing blocks.
function parseBlockInput(type: 'link' | 'header', input: unknown): Result<{ config: { label: string; url?: string } }> {
  const parsed = z.object({ label: LabelSchema, url: z.string().optional() }).safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the title' }
  const { label } = parsed.data
  if (type === 'header') return { ok: true, config: { label } }
  const url = normalizeHttpUrl(parsed.data.url ?? '')
  if (!url) return { ok: false, error: 'Enter a valid web address (https://…)' }
  return { ok: true, config: { label, url } }
}

// Blocks are only stored once they have content, so the page never collects empty rows.
export async function createBioBlock(type: unknown, input: unknown): Promise<Result<{ block: { id: string; type: 'link' | 'header'; label: string; url?: string; hidden: boolean } }>> {
  if (type !== 'link' && type !== 'header') return { ok: false, error: 'Unknown block type' }
  const parsed = parseBlockInput(type, input)
  if (!parsed.ok) return parsed
  const page = await requirePage()
  if ((await listBioBlocks(db(), page.id)).length >= MAX_BLOCKS) {
    return { ok: false, error: `A page can have up to ${MAX_BLOCKS} blocks` }
  }
  const row = await addBioBlock(db(), page.id, type, parsed.config)
  refresh(page.slug)
  return { ok: true, block: { id: row.id, type, label: row.config.label, url: row.config.url, hidden: row.hidden } }
}

export async function saveBioBlock(blockId: string, input: unknown): Promise<Result<{ label: string; url?: string }>> {
  if (!isUuid(blockId)) return { ok: false, error: 'This block no longer exists' }
  const page = await requirePage()
  const block = (await listBioBlocks(db(), page.id)).find((b) => b.id === blockId)
  if (!block) return { ok: false, error: 'This block no longer exists' }

  const parsed = parseBlockInput(block.type, input)
  if (!parsed.ok) return parsed
  await updateBioBlock(db(), page.id, blockId, { config: { ...block.config, ...parsed.config } })
  refresh(page.slug)
  return { ok: true, ...parsed.config }
}

export async function setBioBlockHidden(blockId: string, hidden: boolean): Promise<Result> {
  if (!isUuid(blockId)) return { ok: false, error: 'This block no longer exists' }
  const page = await requirePage()
  const row = await updateBioBlock(db(), page.id, blockId, { hidden: hidden === true })
  if (!row) return { ok: false, error: 'This block no longer exists' }
  refresh(page.slug)
  return { ok: true }
}

export async function removeBioBlock(blockId: string): Promise<Result> {
  if (!isUuid(blockId)) return { ok: false, error: 'This block no longer exists' }
  const page = await requirePage()
  await deleteBioBlock(db(), page.id, blockId)
  refresh(page.slug)
  return { ok: true }
}

export async function moveBioBlock(blockId: string, direction: 'up' | 'down'): Promise<Result> {
  if (!isUuid(blockId) || (direction !== 'up' && direction !== 'down')) return { ok: false, error: 'This block no longer exists' }
  const page = await requirePage()
  await moveBlockRow(db(), page.id, blockId, direction)
  refresh(page.slug)
  return { ok: true }
}

export async function getBioBlockDaily(blockId: string): Promise<Result<{ days: { day: string; clicks: number }[] }>> {
  if (!isUuid(blockId)) return { ok: false, error: 'This block no longer exists' }
  const page = await requirePage()
  return { ok: true, days: await bioBlockDaily(db(), page.id, blockId, 14) }
}
