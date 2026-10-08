'use client'

import { Check, CircleAlert, ImageOff, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, cx } from '@/components/ui'
import { listPosts, listStories } from '@/app/actions'
import type { RecentPost } from '@/lib/data'

const MAX_POSTS = 50

type Loaded = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; posts: RecentPost[] }

export function PostPicker({
  accountId,
  selected,
  onChange,
  source = 'posts',
}: {
  accountId: string
  selected: string[]
  onChange: (mediaIds: string[]) => void
  source?: 'posts' | 'stories'
}) {
  const noun = source === 'stories' ? 'stories' : 'posts'
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoaded({ kind: 'loading' })
    ;(source === 'stories' ? listStories : listPosts)(accountId)
      .then((result) => {
        if (!cancelled) setLoaded(result.ok ? { kind: 'ready', posts: result.posts } : { kind: 'error', message: result.error })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ kind: 'error', message: "Couldn't reach Replyooo. Check your connection and try again." })
      })
    return () => {
      cancelled = true
    }
  }, [accountId, attempt, source])

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id].slice(0, MAX_POSTS))

  if (loaded.kind === 'loading') {
    return (
      <p className="mt-2 flex items-center gap-2 text-[12.5px] text-subtle">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading your {noun}…
      </p>
    )
  }
  if (loaded.kind === 'error') {
    return (
      <p role="alert" className="mt-2 flex flex-wrap items-center gap-x-3 text-[12.5px] text-subtle">
        <CircleAlert className="size-3.5" aria-hidden /> {loaded.message}
        <button type="button" className="font-medium text-ink underline" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </p>
    )
  }
  if (loaded.posts.length === 0) {
    return (
      <p className="mt-2 text-[12.5px] text-subtle">
        {source === 'stories'
          ? 'No live stories right now. Post a story first — stories disappear after 24 hours.'
          : 'No published posts found on this account yet.'}
      </p>
    )
  }

  // Posts older than the latest page still count; they just can't be shown here.
  const hidden = selected.filter((id) => !loaded.posts.some((p) => p.id === id)).length

  return (
    <div className="mt-3">
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {loaded.posts.map((post) => {
          const on = selected.includes(post.id)
          return (
            <li key={post.id}>
              <button
                type="button"
                aria-pressed={on}
                title={post.caption ?? undefined}
                onClick={() => toggle(post.id)}
                className={cx(
                  'relative block aspect-square w-full overflow-hidden rounded-xl border bg-line/40 transition-colors',
                  on ? 'border-brand ring-2 ring-brand' : 'border-line hover:border-faint',
                )}
              >
                {post.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Meta CDN URLs, short-lived and not worth proxying
                  <img src={post.thumbnailUrl} alt={post.caption?.slice(0, 80) ?? (source === 'stories' ? 'Story' : 'Post')} className="size-full object-cover" />
                ) : (
                  <ImageOff className="m-auto size-5 text-faint" aria-hidden />
                )}
                {on && (
                  <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-brand text-white">
                    <Check className="size-3" aria-hidden />
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
      <p className="mt-2 text-[12.5px] text-subtle">
        {selected.length} selected{hidden > 0 && ` (${hidden} not shown here)`}
        {selected.length >= MAX_POSTS && ` — the limit is ${MAX_POSTS}`}
      </p>
    </div>
  )
}

/** The picker in a centred popup; the posts are only fetched while it is open. */
export function PostPickerDialog({
  accountId,
  selected,
  onChange,
  onClose,
  source = 'posts',
}: {
  accountId: string
  selected: string[]
  onChange: (mediaIds: string[]) => void
  onClose: () => void
  source?: 'posts' | 'stories'
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={source === 'stories' ? 'Choose stories' : 'Choose posts'}>
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-[560px] flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-semibold">{source === 'stories' ? 'Choose stories' : 'Choose posts'}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-muted hover:bg-sand"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-4">
          <PostPicker accountId={accountId} selected={selected} onChange={onChange} source={source} />
        </div>
        <div className="flex justify-end border-t border-line px-5 py-3">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  )
}
