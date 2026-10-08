'use client'

import { Check, CircleAlert, ImageOff, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cx } from '@/components/ui'
import { listPosts } from '@/app/actions'
import type { RecentPost } from '@/lib/data'

const MAX_POSTS = 50

type Loaded = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; posts: RecentPost[] }

export function PostPicker({
  accountId,
  selected,
  onChange,
}: {
  accountId: string
  selected: string[]
  onChange: (mediaIds: string[]) => void
}) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoaded({ kind: 'loading' })
    listPosts(accountId)
      .then((result) => {
        if (!cancelled) setLoaded(result.ok ? { kind: 'ready', posts: result.posts } : { kind: 'error', message: result.error })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ kind: 'error', message: "Couldn't reach Replyooo. Check your connection and try again." })
      })
    return () => {
      cancelled = true
    }
  }, [accountId, attempt])

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id].slice(0, MAX_POSTS))

  if (loaded.kind === 'loading') {
    return (
      <p className="mt-2 flex items-center gap-2 text-[12.5px] text-subtle">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading your posts…
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
    return <p className="mt-2 text-[12.5px] text-subtle">No published posts found on this account yet.</p>
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
                  <img src={post.thumbnailUrl} alt={post.caption?.slice(0, 80) ?? 'Post'} className="size-full object-cover" />
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
        {selected.length} selected{hidden > 0 && ` (${hidden} older than the posts shown)`}
        {selected.length >= MAX_POSTS && ` — the limit is ${MAX_POSTS}`}
      </p>
    </div>
  )
}
