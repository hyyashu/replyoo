'use client'

import { renderText, type ContactState } from '@replyooo/engine'
import { useState } from 'react'
import { Camera, ChevronLeft, CornerDownRight, ExternalLink, Heart, MessageCircle, Send, Signal, Wifi, X } from 'lucide-react'
import { Avatar, cx } from '@/components/ui'
import type { RecentPost } from '@/lib/data'
import type { Recipe, RecipeTrigger } from '@/lib/recipe'
import { openerRequired } from '@/lib/recipe'

const SAMPLE: ContactState = { username: 'sam.eats', name: 'Sam Rivera', email: null, phone: null, tags: [], fields: {} }

type Bubble =
  | { kind: 'context'; text: string }
  | { kind: 'them'; text: string }
  | { kind: 'us'; text: string; replyButton?: string; links?: { label: string; url: string }[] }

function previewLinks(links: { label: string; url: string }[]) {
  return links.length > 0 ? { links: links.map((link) => ({ label: link.label || 'Open', url: link.url })) } : {}
}

export type PreviewMode = 'post' | 'comment' | 'story' | 'dm'

/** The screens worth showing for a trigger; one entry means no tabs. */
export function previewModes(trigger: RecipeTrigger): { value: PreviewMode; label: string }[] {
  if (trigger.type === 'comment_keyword') {
    return [
      { value: 'post', label: 'Post' },
      { value: 'comment', label: 'Comments' },
      { value: 'dm', label: 'DM' },
    ]
  }
  if (trigger.type === 'story_reply') {
    return [
      { value: 'story', label: 'Story' },
      { value: 'dm', label: 'DM' },
    ]
  }
  return [{ value: 'dm', label: 'DM' }]
}

/** `starter` picks which conversation starter was tapped; null shows the empty chat. */
export function conversation(recipe: Recipe, starter: number | null = 0): Bubble[] {
  const { trigger } = recipe
  const render = (text: string, contact: ContactState = SAMPLE) => renderText(text, contact, {}) || '…'
  const bubbles: Bubble[] = []

  if (trigger.type === 'ice_breaker') {
    const item = starter === null ? undefined : trigger.items[starter]
    if (item) {
      bubbles.push({ kind: 'context', text: 'sam.eats tapped a conversation starter' })
      bubbles.push({ kind: 'them', text: item.question || '…' })
      bubbles.push({ kind: 'us', text: render(item.answer), ...previewLinks(item.links) })
    }
    return bubbles
  }

  const keyword = 'keywords' in trigger ? (trigger.keywords[0] ?? 'Hi') : 'Hi'
  switch (trigger.type) {
    case 'comment_keyword':
      bubbles.push({ kind: 'context', text: `sam.eats commented “${trigger.keywords[0] ?? 'Love this!'}” on your post` })
      break
    case 'story_reply':
      bubbles.push({ kind: 'context', text: 'sam.eats replied to your story' })
      bubbles.push({ kind: 'them', text: trigger.keywords[0] ?? '🔥🔥' })
      if (trigger.reactWithHeart) bubbles.push({ kind: 'context', text: 'You reacted ❤️ to their reply' })
      break
    default:
      bubbles.push({ kind: 'them', text: trigger.type === 'any_dm' ? 'Hey! Quick question 👋' : keyword })
  }

  if (recipe.opener.enabled || openerRequired(trigger)) {
    bubbles.push({ kind: 'us', text: render(recipe.opener.text), replyButton: recipe.opener.buttonLabel || 'Button' })
    bubbles.push({ kind: 'them', text: recipe.opener.buttonLabel || 'Button' })
  }
  if (recipe.followGate.enabled) {
    bubbles.push({ kind: 'us', text: render(recipe.followGate.text), replyButton: recipe.followGate.buttonLabel || 'Button' })
    bubbles.push({ kind: 'them', text: recipe.followGate.buttonLabel || 'Button' })
  }
  let contact = SAMPLE
  if (recipe.collect.kind !== 'none') {
    const answer = recipe.collect.kind === 'email' ? 'sam@example.com' : '+1 555 0142'
    bubbles.push({ kind: 'us', text: render(recipe.collect.question) })
    bubbles.push({ kind: 'them', text: answer })
    contact = { ...SAMPLE, [recipe.collect.kind]: answer }
  }
  if (recipe.message.imageUrl) bubbles.push({ kind: 'us', text: '🖼 Image' })
  bubbles.push({
    kind: 'us',
    text: render(recipe.message.text, contact),
    ...previewLinks(recipe.message.links),
  })
  return bubbles
}

export function PhonePreview({
  recipe,
  mode,
  username,
  media,
}: {
  recipe: Recipe
  mode: PreviewMode
  username: string
  /** The post or story the automation is set to, when one is chosen and loaded. */
  media?: RecentPost
}) {
  const [starter, setStarter] = useState<number | null>(null)
  return (
    <div className="mx-auto w-[290px] rounded-[46px] bg-ink p-2.5 shadow-[0_24px_60px_rgba(21,19,16,0.22)]">
      <div className="flex h-[580px] flex-col overflow-hidden rounded-[38px] bg-white">
        <div className="flex items-center justify-between px-7 pt-4 pb-2 text-[12.5px] font-semibold">
          9:41
          <span className="flex items-center gap-1">
            <Signal className="size-3.5" />
            <Wifi className="size-3.5" />
          </span>
        </div>
        {mode === 'dm' ? (
          <DmView recipe={recipe} starter={starter} onStarter={setStarter} />
        ) : mode === 'story' ? (
          <StoryView recipe={recipe} username={username} media={media} />
        ) : (
          <CommentView recipe={recipe} username={username} media={media} view={mode === 'post' ? 'post' : 'comments'} />
        )}
      </div>
    </div>
  )
}

function DmView({ recipe, starter, onStarter }: { recipe: Recipe; starter: number | null; onStarter: (index: number | null) => void }) {
  const starters = recipe.trigger.type === 'ice_breaker' ? recipe.trigger.items : []
  const selected = starter !== null && starter < starters.length ? starter : null
  const bubbles = conversation(recipe, selected)
  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-line/60 px-4 pb-3">
        <ChevronLeft className="size-5" />
        <Avatar name="sam.eats" size={30} />
        <div>
          <div className="text-[13px] leading-tight font-semibold">sam.eats</div>
          <div className="text-[11px] text-subtle">Active now</div>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3.5 py-3 [scrollbar-width:none]">
        {starters.length > 0 && selected === null && (
          <p className="py-6 text-center text-[11px] text-subtle">Tap a question below to see what they’d get</p>
        )}
        {bubbles.map((bubble, index) => {
          if (bubble.kind === 'context') {
            return (
              <p key={index} className="py-1 text-center text-[10.5px] text-subtle">
                {bubble.text}
              </p>
            )
          }
          if (bubble.kind === 'them') {
            return (
              <div key={index} className="max-w-[80%] self-start rounded-[18px] bg-[#efefef] px-3 py-2 text-[12.5px] leading-snug">
                {bubble.text}
              </div>
            )
          }
          return (
            <div key={index} className="flex max-w-[84%] flex-col gap-1 self-end">
              <div
                className={cx(
                  'rounded-[18px] bg-violet px-3 py-2 text-[12.5px] leading-snug whitespace-pre-line text-white',
                  bubble.links && 'rounded-b-md',
                )}
              >
                {bubble.text}
              </div>
              {bubble.replyButton && (
                <div className="rounded-xl border border-line px-3 py-1.5 text-center text-[12px] font-semibold text-[#3b5bdb]">
                  {bubble.replyButton}
                </div>
              )}
              {bubble.links && (
                <div className="overflow-hidden rounded-[14px] rounded-t-md border border-line">
                  {bubble.links.map((link, linkIndex) => (
                    <div key={linkIndex} className={cx(linkIndex > 0 && 'border-t border-line')}>
                      <div className="truncate px-3 pt-2 text-[10.5px] text-subtle">{hostOf(link.url)}</div>
                      <div className="m-2 mt-1.5 flex items-center justify-center gap-1 rounded-lg bg-cream py-1.5 text-[12px] font-semibold text-[#3b5bdb]">
                        {link.label} <ExternalLink className="size-3" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {starters.length > 0 && (
        <div className="flex flex-col items-end gap-1.5 px-3.5 pb-2">
          {starters.map((item, index) => (
            <button
              key={index}
              type="button"
              onClick={() => onStarter(selected === index ? null : index)}
              aria-pressed={selected === index}
              className={cx(
                'rounded-full border px-3 py-1 text-[11.5px] font-medium',
                selected === index ? 'border-violet bg-violet text-white' : 'border-line',
              )}
            >
              {item.question || '…'}
            </button>
          ))}
        </div>
      )}
      <div className="m-3 mt-1 flex items-center gap-2 rounded-full border border-line px-3 py-2 text-[12px] text-faint">
        <Camera className="size-4 text-[#3b5bdb]" /> Message…
      </div>
    </>
  )
}

function StoryView({ recipe, username, media }: { recipe: Recipe; username: string; media?: RecentPost }) {
  const trigger = recipe.trigger
  if (trigger.type !== 'story_reply') return null
  const reply = trigger.keywords[0] ?? '🔥🔥'
  return (
    <div className="relative flex flex-1 flex-col bg-[linear-gradient(160deg,#ffd7c4,#ff9a76_55%,#ff4f1f)] text-white">
      {media?.thumbnailUrl && <MediaImage url={media.thumbnailUrl} className="absolute inset-0 size-full" />}
      <div className="relative mx-3 mt-1 h-0.5 rounded-full bg-white/40">
        <div className="h-full w-1/3 rounded-full bg-white" />
      </div>
      <div className="relative flex items-center gap-2 px-3 pt-2.5">
        <Avatar name={username} size={26} />
        <span className="text-[12.5px] font-semibold">{username}</span>
        <span className="text-[11px] text-white/80">2h</span>
        <X className="ml-auto size-4" />
      </div>
      <div className="flex-1" />
      <div className="relative mx-3 mb-3 flex flex-col gap-2">
        <div className="self-start rounded-[16px] bg-black/35 px-3 py-1.5 text-[11.5px]">
          <span className="font-semibold">sam.eats</span> replied: {reply}
          {trigger.includeReactions && <span className="ml-1 text-white/80">· or reacts with an emoji</span>}
        </div>
        {trigger.reactWithHeart && <p className="self-start text-[10.5px] text-white/85">You react ❤️ to their reply</p>}
        <div className="flex items-center gap-2.5">
          <div className="flex-1 rounded-full border border-white/70 px-3.5 py-2 text-[12px] text-white/90">Send message</div>
          <Heart className="size-5" />
          <Send className="size-5" />
        </div>
      </div>
    </div>
  )
}

function CommentView({ recipe, username, media, view }: { recipe: Recipe; username: string; media?: RecentPost; view: 'post' | 'comments' }) {
  const trigger = recipe.trigger
  if (trigger.type !== 'comment_keyword') {
    return (
      <div className="grid flex-1 place-items-center px-8 text-center text-[13px] text-subtle">
        This automation starts in DMs — there’s no public comment.
      </div>
    )
  }
  const replies = trigger.publicReplies.enabled ? trigger.publicReplies.replies.filter((r) => r.trim()) : []
  const keyword = trigger.keywords[0]
  const postHeader = (
    <div className="flex items-center gap-2 px-4 pb-2">
      <Avatar name={username} size={26} />
      <span className="text-[12.5px] font-semibold">{username}</span>
    </div>
  )
  if (view === 'post') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {postHeader}
        <div className="aspect-square overflow-hidden bg-[linear-gradient(135deg,#ffd7c4,#ffb59a_55%,#ff4f1f)]">
          {media?.thumbnailUrl && <MediaImage url={media.thumbnailUrl} className="size-full" />}
        </div>
        <div className="flex items-center gap-3 px-4 py-2">
          <Heart className="size-4.5" />
          <MessageCircle className="size-4.5" />
          <Send className="size-4.5" />
        </div>
        <div className="px-4 text-[11.5px] font-semibold">1,284 likes</div>
        <p className="px-4 pt-1 text-[12.5px] leading-snug">
          <span className="font-semibold">{username}</span>{' '}
          {media?.caption ? media.caption.slice(0, 90) : keyword ? `Comment “${keyword}” and I’ll send it to your DMs ✨` : 'New post — leave a comment!'}
        </p>
        <p className="px-4 pt-1.5 text-[11.5px] text-subtle">View all 23 comments</p>
      </div>
    )
  }
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-line/60 py-2 text-center text-[12.5px] font-semibold">Comments</div>
      <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3">
        <div className="flex gap-2">
          <Avatar name="sam.eats" size={24} />
          <p className="text-[12.5px] leading-snug">
            <span className="font-semibold">sam.eats</span> {keyword ?? 'GUIDE'} 🙌
          </p>
        </div>
        {replies.length > 0 ? (
          <div className="ml-7 flex gap-2">
            <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-faint" />
            <Avatar name={username} size={22} />
            <div>
              <p className="text-[12.5px] leading-snug">
                <span className="font-semibold">{username}</span> @sam.eats {renderText(replies[0] ?? '', SAMPLE, {})}
              </p>
              {replies.length > 1 && (
                <p className="mt-1 text-[10.5px] text-subtle">Rotates between {replies.length} replies</p>
              )}
            </div>
          </div>
        ) : (
          <p className="ml-7 text-[11px] text-subtle">No public reply — they only get the DM.</p>
        )}
      </div>
    </div>
  )
}

function MediaImage({ url, className }: { url: string; className: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- Meta CDN URLs, short-lived and not worth proxying
  return <img src={url} alt="" className={cx('object-cover', className)} />
}

function hostOf(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url || 'link'
  }
}
