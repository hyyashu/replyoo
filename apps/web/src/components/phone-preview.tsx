'use client'

import { renderText, type ContactState } from '@replyooo/engine'
import { Camera, ChevronLeft, CornerDownRight, ExternalLink, Heart, Signal, Wifi } from 'lucide-react'
import { Avatar, cx } from '@/components/ui'
import type { Recipe } from '@/lib/recipe'
import { openerRequired } from '@/lib/recipe'

const SAMPLE: ContactState = { username: 'sam.eats', name: 'Sam Rivera', email: null, phone: null, tags: [], fields: {} }

type Bubble =
  | { kind: 'context'; text: string }
  | { kind: 'them'; text: string }
  | { kind: 'us'; text: string; replyButton?: string; links?: { label: string; url: string }[] }

function previewLinks(links: { label: string; url: string }[]) {
  return links.length > 0 ? { links: links.map((link) => ({ label: link.label || 'Open', url: link.url })) } : {}
}

export function conversation(recipe: Recipe): Bubble[] {
  const { trigger } = recipe
  const render = (text: string, contact: ContactState = SAMPLE) => renderText(text, contact, {}) || '…'
  const bubbles: Bubble[] = []

  if (trigger.type === 'ice_breaker') {
    const item = trigger.items[0]
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

export function PhonePreview({ recipe, mode, username }: { recipe: Recipe; mode: 'comment' | 'dm'; username: string }) {
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
        {mode === 'dm' ? <DmView recipe={recipe} /> : <CommentView recipe={recipe} username={username} />}
      </div>
    </div>
  )
}

function DmView({ recipe }: { recipe: Recipe }) {
  const bubbles = conversation(recipe)
  const starters = recipe.trigger.type === 'ice_breaker' ? recipe.trigger.items : []
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
            <span key={index} className="rounded-full border border-line px-3 py-1 text-[11.5px] font-medium">
              {item.question || '…'}
            </span>
          ))}
        </div>
      )}
      <div className="m-3 mt-1 flex items-center gap-2 rounded-full border border-line px-3 py-2 text-[12px] text-faint">
        <Camera className="size-4 text-[#3b5bdb]" /> Message…
      </div>
    </>
  )
}

function CommentView({ recipe, username }: { recipe: Recipe; username: string }) {
  const trigger = recipe.trigger
  if (trigger.type !== 'comment_keyword') {
    return (
      <div className="grid flex-1 place-items-center px-8 text-center text-[13px] text-subtle">
        This automation starts in DMs — there’s no public comment.
      </div>
    )
  }
  const replies = trigger.publicReplies.enabled ? trigger.publicReplies.replies.filter((r) => r.trim()) : []
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 pb-2">
        <Avatar name={username} size={26} />
        <span className="text-[12.5px] font-semibold">{username}</span>
      </div>
      <div className="mx-0 aspect-[4/3] bg-[linear-gradient(135deg,#ffd7c4,#ffb59a_55%,#ff4f1f)]" />
      <div className="flex items-center gap-3 px-4 py-2">
        <Heart className="size-4.5" />
        <span className="text-[11.5px] text-subtle">1,284 likes</span>
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto border-t border-line/60 px-4 py-3">
        <div className="flex gap-2">
          <Avatar name="sam.eats" size={24} />
          <p className="text-[12.5px] leading-snug">
            <span className="font-semibold">sam.eats</span> {trigger.keywords[0] ?? 'GUIDE'} 🙌
          </p>
        </div>
        {replies.length > 0 ? (
          <div className="ml-7 flex gap-2">
            <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-faint" />
            <Avatar name={username} size={22} />
            <div>
              <p className="text-[12.5px] leading-snug">
                <span className="font-semibold">{username}</span> @sam.eats {replies[0]}
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

function hostOf(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url || 'link'
  }
}
