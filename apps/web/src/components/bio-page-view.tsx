import { ExternalLink } from 'lucide-react'
import type { CSSProperties } from 'react'
import { isSafeHttpUrl, themeVars } from '@/lib/bio'

export interface BioViewBlock {
  id: string
  type: 'link' | 'header'
  label: string
  url?: string
  hidden: boolean
}

export interface BioViewData {
  /** Set on the public page so link clicks go through the counting redirect. */
  slug?: string
  displayName: string
  bio: string
  avatarUrl: string | null
  theme: string
  showBadge: boolean
  blocks: BioViewBlock[]
}

/**
 * The one renderer behind both the public /u/[slug] page and the editor's phone preview.
 * Themes are CSS variable sets set on the root; `preview` renders links as inert boxes.
 */
export function BioPageView({ page, preview = false }: { page: BioViewData; preview?: boolean }) {
  // Drafts (no title, or a link without a usable address) only show in the editor preview.
  const visible = page.blocks.filter((block) => {
    if (preview) return !block.hidden
    if (block.hidden || !block.label.trim()) return false
    return block.type === 'header' || isSafeHttpUrl(block.url)
  })
  const initial = (page.displayName.trim()[0] ?? '?').toUpperCase()

  return (
    <div
      style={{ ...themeVars(page.theme), background: 'var(--bio-bg)', color: 'var(--bio-text)' } as CSSProperties}
      className={preview ? 'flex min-h-full flex-col px-5 py-8' : 'flex min-h-screen flex-col px-5 py-12'}
    >
      <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center">
        {page.avatarUrl && isSafeHttpUrl(page.avatarUrl) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={page.avatarUrl} alt="" className="size-24 rounded-full object-cover" />
        ) : (
          <div
            style={{ background: 'var(--bio-avatar-bg)', color: 'var(--bio-avatar-text)' }}
            className="grid size-24 place-items-center rounded-full font-display text-[38px] font-bold"
          >
            {initial}
          </div>
        )}
        <h1 className="mt-4 text-center font-display text-[22px] leading-tight font-bold tracking-[-0.03em] break-words">
          {page.displayName || 'Your name'}
        </h1>
        {page.bio && (
          <p style={{ color: 'var(--bio-muted)' }} className="mt-2 max-w-[420px] text-center text-[14.5px] leading-snug break-words whitespace-pre-line">
            {page.bio}
          </p>
        )}

        <ul className="mt-7 flex w-full flex-col gap-3">
          {visible.map((block) =>
            block.type === 'header' ? (
              <li key={block.id} className="pt-3 text-center text-[13px] font-semibold tracking-wide break-words uppercase" style={{ color: 'var(--bio-muted)' }}>
                {block.label}
              </li>
            ) : (
              <li key={block.id}>
                <LinkCard block={block} preview={preview} slug={page.slug} />
              </li>
            ),
          )}
        </ul>
      </div>

      {page.showBadge && (
        <p className="mt-10 text-center text-[12px] font-medium" style={{ color: 'var(--bio-muted)' }}>
          Made with{' '}
          {preview ? (
            <span className="font-bold">Replyooo</span>
          ) : (
            <a href="/" className="font-bold underline-offset-2 hover:underline">
              Replyooo
            </a>
          )}
        </p>
      )}
    </div>
  )
}

function LinkCard({ block, preview, slug }: { block: BioViewBlock; preview: boolean; slug?: string }) {
  const className =
    'flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-center text-[15px] font-semibold break-words shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition-transform'
  const style: CSSProperties = {
    background: 'var(--bio-card-bg)',
    color: 'var(--bio-card-text)',
    border: '1px solid var(--bio-card-border)',
  }
  const label = block.label || 'Untitled link'
  if (preview || !isSafeHttpUrl(block.url)) {
    return (
      <div style={style} className={className}>
        {label}
      </div>
    )
  }
  return (
    <a href={slug ? `/u/${slug}/out/${block.id}` : block.url} target="_blank" rel="noopener noreferrer" style={style} className={`${className} hover:scale-[1.02]`}>
      {label}
      <ExternalLink className="size-3.5 shrink-0 opacity-50" />
    </a>
  )
}
