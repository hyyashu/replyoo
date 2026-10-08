'use client'

import { ArrowDown, ArrowUp, BarChart3, Check, Copy, Eye, EyeOff, Heading, Link2, Pencil, Plus, Trash2, ExternalLink, Smartphone } from 'lucide-react'
import type { BioOverview } from '@replyooo/db'
import { useRef, useState, useTransition } from 'react'
import {
  createBioBlock,
  moveBioBlock,
  removeBioBlock,
  saveBioBlock,
  saveBioDetails,
  setBioBlockHidden,
} from '@/app/bio-actions'
import { BioPageView, type BioViewBlock } from '@/components/bio-page-view'
import { Button, Card, PageHeader, cx } from '@/components/ui'
import { BlockInsights, PageStats } from './stats'
import { BIO_MAX, BIO_THEMES, LABEL_MAX, NAME_MAX, THEME_IDS } from '@/lib/bio'

interface Details {
  displayName: string
  bio: string
  theme: string
}

const inputClass =
  'h-10 w-full rounded-xl border border-line bg-white px-3 text-[14.5px] outline-none focus:border-ink'

export function BioEditor({
  publicUrl,
  slug,
  initial,
  avatarUrl,
  showBadge,
  initialBlocks,
  stats,
}: {
  publicUrl: string
  slug: string
  initial: Details
  avatarUrl: string | null
  showBadge: boolean
  initialBlocks: BioViewBlock[]
  stats: BioOverview
}) {
  const [tab, setTab] = useState<'links' | 'design'>('links')
  const [details, setDetails] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [blocks, setBlocks] = useState(initialBlocks)
  // New blocks stay on this screen until they have content, then they are saved for the first time.
  const [drafts, setDrafts] = useState<BioViewBlock[]>([])
  const draftCount = useRef(0)
  // Last saved label/url per block, to know which rows have unsaved edits.
  const savedBlocks = useRef(new Map(initialBlocks.map((b) => [b.id, { label: b.label, url: b.url ?? '' }])))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editingDetails, setEditingDetails] = useState(false)
  const [insightsFor, setInsightsFor] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const detailsDirty = details.displayName !== saved.displayName || details.bio !== saved.bio || details.theme !== saved.theme
  const setError = (key: string, message: string | null) =>
    setErrors((current) => {
      const next = { ...current }
      if (message) next[key] = message
      else delete next[key]
      return next
    })

  const preview = { ...details, avatarUrl, showBadge, blocks: [...blocks, ...drafts] }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setNotice('Copy failed. Select the address and copy it manually.')
    }
  }

  const saveDetails = () =>
    startTransition(async () => {
      setNotice(null)
      const result = await saveBioDetails(details)
      if (!result.ok) return setError('details', result.error)
      setError('details', null)
      const next = { displayName: result.displayName, bio: result.bio, theme: result.theme }
      setDetails(next)
      setSaved(next)
      setEditingDetails(false)
    })

  const cancelDetails = () => {
    // Theme is picked on the Design tab, so only the text fields are reverted here.
    setDetails((current) => ({ ...current, displayName: saved.displayName, bio: saved.bio }))
    setError('details', null)
    setEditingDetails(false)
  }

  const addBlock = (type: 'link' | 'header') => {
    setNotice(null)
    draftCount.current += 1
    setDrafts((current) => [...current, { id: `draft-${draftCount.current}`, type, label: '', ...(type === 'link' && { url: '' }), hidden: false }])
  }

  const patchDraft = (id: string, patch: Partial<BioViewBlock>) =>
    setDrafts((current) => current.map((b) => (b.id === id ? { ...b, ...patch } : b)))

  const saveDraft = (draft: BioViewBlock) =>
    startTransition(async () => {
      const result = await createBioBlock(draft.type, { label: draft.label, url: draft.url })
      if (!result.ok) return setError(draft.id, result.error)
      setError(draft.id, null)
      savedBlocks.current.set(result.block.id, { label: result.block.label, url: result.block.url ?? '' })
      setBlocks((current) => [...current, result.block])
      setDrafts((current) => current.filter((b) => b.id !== draft.id))
    })

  const patchBlock = (id: string, patch: Partial<BioViewBlock>) =>
    setBlocks((current) => current.map((b) => (b.id === id ? { ...b, ...patch } : b)))

  const saveBlock = (block: BioViewBlock) =>
    startTransition(async () => {
      const result = await saveBioBlock(block.id, { label: block.label, url: block.url })
      if (!result.ok) return setError(block.id, result.error)
      setError(block.id, null)
      savedBlocks.current.set(block.id, { label: result.label, url: result.url ?? '' })
      patchBlock(block.id, { label: result.label, ...(result.url !== undefined && { url: result.url }) })
    })

  const toggle = (block: BioViewBlock) => {
    patchBlock(block.id, { hidden: !block.hidden })
    startTransition(async () => {
      const result = await setBioBlockHidden(block.id, !block.hidden)
      if (!result.ok) {
        patchBlock(block.id, { hidden: block.hidden })
        setNotice(result.error)
      }
    })
  }

  const remove = (block: BioViewBlock) => {
    const before = blocks
    setBlocks((current) => current.filter((b) => b.id !== block.id))
    startTransition(async () => {
      const result = await removeBioBlock(block.id)
      if (!result.ok) {
        setBlocks(before)
        setNotice(result.error)
      }
    })
  }

  const move = (index: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= blocks.length) return
    const before = blocks
    const next = [...blocks]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    setBlocks(next)
    startTransition(async () => {
      const result = await moveBioBlock(before[index]!.id, direction)
      if (!result.ok) {
        setBlocks(before)
        setNotice(result.error)
      }
    })
  }

  const previewPanel = (
    <>
      <h2 className="text-[15px] font-semibold">Live preview</h2>
      <div className="mt-5">
        <div className="mx-auto w-[290px] rounded-[46px] bg-ink p-2.5 shadow-[0_24px_60px_rgba(21,19,16,0.22)]">
          <div className="h-[580px] overflow-y-auto rounded-[38px] bg-white [scrollbar-width:none]">
            <BioPageView page={preview} preview />
          </div>
        </div>
      </div>
      <p className="mx-auto mt-5 max-w-[290px] text-center text-[12.5px] leading-relaxed text-subtle">
        Updates as you type. Unsaved changes only show here until you save.
      </p>
    </>
  )

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-6 sm:px-10 sm:py-9">
      <PageHeader
        title="Bio page"
        subtitle="One link for your Instagram bio. Share everything you want people to find."
        actions={
          <Button variant="secondary" className="xl:hidden" onClick={() => setPreviewOpen(!previewOpen)} aria-expanded={previewOpen}>
            <Smartphone className="size-4" /> {previewOpen ? 'Hide preview' : 'Preview'}
          </Button>
        }
      />

      <div className="mt-6 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-3">
        <Link2 className="ml-1 size-4 shrink-0 text-subtle" />
        <input readOnly value={publicUrl} aria-label="Public URL" onFocus={(e) => e.currentTarget.select()} className="h-9 min-w-0 flex-1 bg-transparent text-[14px] outline-none" />
        <Button variant="secondary" size="sm" onClick={copy}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? 'Copied' : 'Copy'}
        </Button>
        <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-2 rounded-full bg-ink px-3 text-[13px] font-semibold text-white hover:bg-ink-2">
          <ExternalLink className="size-3.5" /> Open
        </a>
      </div>

      <PageStats stats={stats} />

      {previewOpen && <div className="mt-6 rounded-[20px] bg-sand px-6 py-6 xl:hidden">{previewPanel}</div>}

      <div className="mt-6 grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div className="inline-flex rounded-full bg-sand p-1" role="tablist">
            {(['links', 'design'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cx(
                  'h-9 rounded-full px-5 text-[14px] font-semibold capitalize transition-colors',
                  tab === value ? 'bg-white text-ink shadow-[0_1px_2px_rgba(21,19,16,0.08)]' : 'text-muted hover:text-ink',
                )}
              >
                {value}
              </button>
            ))}
          </div>

          {notice && (
            <p role="alert" className="mt-4 rounded-xl bg-brand-tint px-4 py-2.5 text-[13.5px]">
              {notice}
            </p>
          )}

          {tab === 'links' ? (
            <div className="mt-5 flex flex-col gap-5">
              {editingDetails ? (
              <Card className="p-5">
                <h2 className="text-[16px] font-semibold">Page details</h2>
                <label className="mt-4 block text-[13px] font-medium text-muted" htmlFor="bio-name">
                  Display name
                </label>
                <input
                  id="bio-name"
                  value={details.displayName}
                  maxLength={NAME_MAX}
                  onChange={(e) => setDetails({ ...details, displayName: e.target.value })}
                  className={cx(inputClass, 'mt-1.5')}
                />
                <div className="mt-4 flex items-center justify-between text-[13px] font-medium text-muted">
                  <label htmlFor="bio-text">Bio</label>
                  <span className={details.bio.length >= BIO_MAX ? 'text-brand' : 'text-subtle'}>
                    {details.bio.length}/{BIO_MAX}
                  </span>
                </div>
                <textarea
                  id="bio-text"
                  value={details.bio}
                  maxLength={BIO_MAX}
                  rows={3}
                  onChange={(e) => setDetails({ ...details, bio: e.target.value })}
                  className="mt-1.5 w-full resize-none rounded-xl border border-line bg-white px-3 py-2 text-[14.5px] outline-none focus:border-ink"
                />
                <div className="mt-4 flex items-center gap-3">
                  <Button onClick={saveDetails} disabled={pending || !detailsDirty}>
                    Save changes
                  </Button>
                  <Button variant="secondary" onClick={cancelDetails} disabled={pending}>
                    Cancel
                  </Button>
                  {errors.details && <span className="text-[13px] text-brand">{errors.details}</span>}
                </div>
              </Card>

              ) : (
                <Card className="flex items-center gap-3 p-4">
                  <div className="grid size-10 shrink-0 place-items-center rounded-full bg-sand text-[15px] font-semibold">
                    {(saved.displayName.trim()[0] ?? '?').toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold">{saved.displayName}</div>
                    <div className="truncate text-[13px] text-subtle">
                      @{slug} · {BIO_THEMES[saved.theme as keyof typeof BIO_THEMES]?.label.toLowerCase() ?? saved.theme} theme
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setEditingDetails(true)}>
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                </Card>
              )}

              <Card className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-[16px] font-semibold">Blocks</h2>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => addBlock('link')}>
                      <Plus className="size-3.5" /> Link
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => addBlock('header')}>
                      <Heading className="size-3.5" /> Header
                    </Button>
                  </div>
                </div>
                {blocks.length === 0 && drafts.length === 0 ? (
                  <p className="mt-4 rounded-xl bg-sand px-4 py-6 text-center text-[14px] text-muted">
                    No blocks yet. Add a link to get started.
                  </p>
                ) : (
                  <ul className="mt-4 flex flex-col gap-3">
                    {blocks.map((block, index) => {
                      const base = savedBlocks.current.get(block.id)
                      const dirty = !base || base.label !== block.label || base.url !== (block.url ?? '')
                      return (
                        <li key={block.id} className={cx('rounded-2xl border border-line p-3.5', block.hidden && 'bg-sand/60')}>
                          <div className="flex items-start gap-3">
                            <div className="flex flex-col gap-0.5">
                              <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => move(index, 'up')} className="grid size-7 place-items-center rounded-lg text-muted hover:bg-sand disabled:opacity-30">
                                <ArrowUp className="size-4" />
                              </button>
                              <button type="button" aria-label="Move down" disabled={index === blocks.length - 1} onClick={() => move(index, 'down')} className="grid size-7 place-items-center rounded-lg text-muted hover:bg-sand disabled:opacity-30">
                                <ArrowDown className="size-4" />
                              </button>
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col gap-2">
                              <input
                                aria-label={block.type === 'link' ? 'Link title' : 'Header text'}
                                placeholder={block.type === 'link' ? 'Link title' : 'Header text'}
                                value={block.label}
                                maxLength={LABEL_MAX}
                                onChange={(e) => patchBlock(block.id, { label: e.target.value })}
                                className={inputClass}
                              />
                              {block.type === 'link' && (
                                <input
                                  aria-label="Link URL"
                                  placeholder="https://example.com"
                                  inputMode="url"
                                  value={block.url ?? ''}
                                  onChange={(e) => patchBlock(block.id, { url: e.target.value })}
                                  className={inputClass}
                                />
                              )}
                              {errors[block.id] && <p className="text-[12.5px] text-brand">{errors[block.id]}</p>}
                              {dirty && (
                                <div>
                                  <Button size="sm" onClick={() => saveBlock(block)} disabled={pending}>
                                    Save {block.type}
                                  </Button>
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col gap-0.5">
                              {block.type === 'link' && (
                                <button type="button" aria-label="Link insights" aria-pressed={insightsFor === block.id} onClick={() => setInsightsFor(insightsFor === block.id ? null : block.id)} className={cx('grid size-8 place-items-center rounded-lg text-muted hover:bg-sand', insightsFor === block.id && 'bg-sand text-ink')}>
                                  <BarChart3 className="size-4" />
                                </button>
                              )}
                              <button type="button" aria-label={block.hidden ? 'Show on page' : 'Hide from page'} aria-pressed={block.hidden} onClick={() => toggle(block)} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-sand">
                                {block.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                              </button>
                              <button type="button" aria-label="Delete block" onClick={() => remove(block)} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-brand-tint hover:text-brand">
                                <Trash2 className="size-4" />
                              </button>
                            </div>
                          </div>
                          {insightsFor === block.id && <BlockInsights blockId={block.id} stats={stats.blocks[block.id]} overview={stats} />}
                        </li>
                      )
                    })}
                    {drafts.map((draft) => (
                      <li key={draft.id} className="rounded-2xl border border-dashed border-line p-3.5">
                        <div className="flex items-start gap-3">
                          <div className="flex min-w-0 flex-1 flex-col gap-2">
                            <input
                              aria-label={draft.type === 'link' ? 'Link title' : 'Header text'}
                              placeholder={draft.type === 'link' ? 'Link title' : 'Header text'}
                              value={draft.label}
                              maxLength={LABEL_MAX}
                              onChange={(e) => patchDraft(draft.id, { label: e.target.value })}
                              className={inputClass}
                            />
                            {draft.type === 'link' && (
                              <input
                                aria-label="Link URL"
                                placeholder="https://example.com"
                                inputMode="url"
                                value={draft.url ?? ''}
                                onChange={(e) => patchDraft(draft.id, { url: e.target.value })}
                                className={inputClass}
                              />
                            )}
                            {errors[draft.id] && <p className="text-[12.5px] text-brand">{errors[draft.id]}</p>}
                            <div>
                              <Button size="sm" onClick={() => saveDraft(draft)} disabled={pending || (!draft.label.trim() && !(draft.url ?? '').trim())}>
                                Save {draft.type}
                              </Button>
                            </div>
                          </div>
                          <button type="button" aria-label="Discard draft" onClick={() => setDrafts((current) => current.filter((b) => b.id !== draft.id))} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-brand-tint hover:text-brand">
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          ) : (
            <Card className="mt-5 p-5">
              <h2 className="text-[16px] font-semibold">Theme</h2>
              <p className="mt-1 text-[13.5px] text-muted">Pick a look. The preview updates right away; it goes live when you save.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Theme">
                {THEME_IDS.map((id) => {
                  const theme = BIO_THEMES[id]
                  const active = details.theme === id
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setDetails({ ...details, theme: id })}
                      className={cx('rounded-2xl border-2 p-2.5 text-left transition-colors', active ? 'border-ink' : 'border-line hover:border-faint')}
                    >
                      <div style={{ background: theme.vars['--bio-bg'] }} className="flex h-28 flex-col items-center justify-center gap-1.5 rounded-xl px-4">
                        <div style={{ background: theme.vars['--bio-avatar-bg'] }} className="size-6 rounded-full" />
                        <div style={{ background: theme.vars['--bio-card-bg'], border: `1px solid ${theme.vars['--bio-card-border']}` }} className="h-5 w-full rounded-lg" />
                        <div style={{ background: theme.vars['--bio-card-bg'], border: `1px solid ${theme.vars['--bio-card-border']}` }} className="h-5 w-full rounded-lg" />
                      </div>
                      <div className="mt-2.5 flex items-center justify-between px-1">
                        <span className="text-[14px] font-semibold">{theme.label}</span>
                        {active && <Check className="size-4" />}
                      </div>
                      <p className="px-1 text-[12px] text-subtle">{theme.blurb}</p>
                    </button>
                  )
                })}
              </div>
              <div className="mt-5 flex items-center gap-3">
                <Button onClick={saveDetails} disabled={pending || !detailsDirty}>
                  Save
                </Button>
                {errors.details && <span className="text-[13px] text-brand">{errors.details}</span>}
                {!errors.details && !detailsDirty && <span className="text-[13px] text-subtle">All changes saved</span>}
              </div>
            </Card>
          )}
        </div>

        <aside className="hidden xl:block">
          <div className="sticky top-6 rounded-[20px] bg-sand px-6 py-6">{previewPanel}</div>
        </aside>
      </div>
    </div>
  )
}
