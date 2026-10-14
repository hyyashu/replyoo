'use client'

import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Field, toolField } from '@/components/tools/shared'
import { Button, formatNumber } from '@/components/ui'
import { engagementRate } from '@/lib/tools/engagement'

type PostRow = { likes: string; comments: string; saves: string; shares: string }
const EMPTY: PostRow = { likes: '', comments: '', saves: '', shares: '' }
const COLUMNS: { key: keyof PostRow; label: string }[] = [
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'saves', label: 'Saves' },
  { key: 'shares', label: 'Shares' },
]
const MAX_POSTS = 12

const toNumber = (value: string) => Number(value.replace(/[,\s]/g, '')) || 0

export function EngagementTool() {
  const [followers, setFollowers] = useState('')
  const [posts, setPosts] = useState<PostRow[]>([{ ...EMPTY }, { ...EMPTY }, { ...EMPTY }])
  const filled = posts.filter((p) => Object.values(p).some((v) => v.trim()))
  const result = engagementRate({
    followers: toNumber(followers),
    posts: filled.map((p) => ({ likes: toNumber(p.likes), comments: toNumber(p.comments), saves: toNumber(p.saves), shares: toNumber(p.shares) })),
  })

  const update = (index: number, key: keyof PostRow, value: string) =>
    setPosts((current) => current.map((p, i) => (i === index ? { ...p, [key]: value } : p)))

  return (
    <div className="flex flex-col gap-5">
      <Field label="Followers">
        {(id) => (
          <input id={id} value={followers} onChange={(e) => setFollowers(e.target.value)} inputMode="numeric" placeholder="12,400" className={toolField} />
        )}
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] font-semibold">Recent posts</legend>
        <p className="text-[12.5px] text-subtle">Saves and shares are optional; they are in each post’s Insights.</p>
        {posts.map((post, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="w-6 shrink-0 text-[12.5px] text-subtle tabular-nums">{index + 1}</span>
            <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
              {COLUMNS.map((column) => (
                <input
                  key={column.key}
                  aria-label={`Post ${index + 1} ${column.label.toLowerCase()}`}
                  value={post[column.key]}
                  onChange={(e) => update(index, column.key, e.target.value)}
                  inputMode="numeric"
                  placeholder={column.label}
                  className={toolField}
                />
              ))}
            </div>
            <button
              type="button"
              aria-label={`Remove post ${index + 1}`}
              onClick={() => setPosts((current) => current.filter((_, i) => i !== index))}
              disabled={posts.length === 1}
              className="grid size-8 shrink-0 place-items-center rounded-full text-subtle hover:bg-sand hover:text-ink disabled:opacity-30"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
        <Button variant="secondary" size="sm" className="self-start" onClick={() => setPosts((current) => [...current, { ...EMPTY }])} disabled={posts.length >= MAX_POSTS}>
          <Plus className="size-3.5" /> Add a post
        </Button>
      </fieldset>
      <div className="grid grid-cols-2 gap-3" aria-live="polite">
        <div className="rounded-2xl bg-sand p-4">
          <div className="eyebrow">Engagement rate</div>
          <div className="mt-1 font-display text-[34px] leading-none font-bold tracking-tight tabular-nums">
            {result ? `${(result.rate * 100).toFixed(2)}%` : '—'}
          </div>
        </div>
        <div className="rounded-2xl bg-sand p-4">
          <div className="eyebrow">Interactions per post</div>
          <div className="mt-1 font-display text-[34px] leading-none font-bold tracking-tight tabular-nums">
            {result ? formatNumber(Math.round(result.averageInteractions)) : '—'}
          </div>
        </div>
      </div>
      {!result && <p className="-mt-2 text-[12.5px] text-subtle">Add your followers and at least one post.</p>}
    </div>
  )
}
