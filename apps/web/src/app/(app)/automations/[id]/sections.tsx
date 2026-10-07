'use client'

import type { Platform } from '@replyooo/shared'
import { AtSign, BellRing, ChevronDown, CircleAlert, Link2, Phone, Plus, Tag, Trash2, UserPlus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Toggle, cx } from '@/components/ui'
import {
  COLLECT_DEFAULTS,
  MAX_LINKS,
  MAX_NUDGE_HOURS,
  changeTriggerType,
  nudgeApplies,
  openerRequired,
  type LinkButton,
  type Recipe,
  type RecipeTrigger,
} from '@/lib/recipe'
import type { RecipeIssue, RecipeSection } from '@/lib/validation'
import { KeywordInput, Label, MessageInput, Segmented, TextInput } from './fields'

export type Update = (fn: (draft: Recipe) => void) => void

/** Posts would come from the Graph API media endpoint once the account is connected (Plan 3). */
const POSTS = [
  { id: 'reel_breakfast', label: 'Reel', style: 'bg-[linear-gradient(135deg,#ffd7c4,#ff4f1f)]' },
  { id: 'post_pantry', label: 'Post', style: 'bg-[linear-gradient(135deg,#e6f6b5,#4c8a0b)]' },
  { id: 'carousel_brunch', label: 'Carousel', style: 'bg-[linear-gradient(135deg,#cde9ff,#3b5bdb)]' },
  { id: 'reel_smoothie', label: 'Reel', style: 'bg-[linear-gradient(135deg,#ded8ff,#6b4bff)]' },
]

function Section({
  index,
  title,
  subtitle,
  issues,
  action,
  children,
  defaultOpen = true,
}: {
  index: number
  title: string
  subtitle: string
  issues: RecipeIssue[]
  action?: ReactNode
  children?: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section
      className={cx(
        'rounded-[20px] border bg-white transition-colors',
        issues.length > 0 ? 'border-[#ffb59a]' : 'border-line',
      )}
    >
      <header className="flex items-center gap-3.5 px-5 py-4">
        <span className="grid size-[26px] shrink-0 place-items-center rounded-lg bg-ink font-mono text-[12px] font-semibold text-white">
          {index}
        </span>
        <button type="button" onClick={() => children && setOpen(!open)} className="min-w-0 flex-1 text-left">
          <h2 className="text-[15.5px] font-semibold">{title}</h2>
          <p className="truncate text-[12.5px] text-subtle">{subtitle}</p>
        </button>
        {action}
        {children && (
          <button type="button" onClick={() => setOpen(!open)} aria-label={open ? 'Collapse' : 'Expand'}>
            <ChevronDown className={cx('size-4 text-subtle transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </header>
      {open && children && <div className="flex flex-col gap-4 px-5 pb-5 sm:pl-[62px]">{children}</div>}
      {issues.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-[#ffd7c4] bg-brand-tint px-5 py-3 sm:pl-[62px]">
          {issues.map((issue) => (
            <li key={issue.message} className="flex items-start gap-2 text-[13px] text-[#a12b0b]">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const TRIGGER_OPTIONS: { value: RecipeTrigger['type']; label: string; instagramOnly?: boolean }[] = [
  { value: 'comment_keyword', label: 'Comment' },
  { value: 'dm_keyword', label: 'DM keyword' },
  { value: 'story_reply', label: 'Story reply', instagramOnly: true },
  { value: 'any_dm', label: 'Any DM' },
  { value: 'ice_breaker', label: 'Starters' },
]

export function TriggerSection({
  recipe,
  update,
  platform,
  issues,
}: {
  recipe: Recipe
  update: Update
  platform: Platform
  issues: (section: RecipeSection) => RecipeIssue[]
}) {
  const { trigger } = recipe
  const subtitle = {
    comment_keyword: 'Someone comments on your post — with a keyword, or any comment',
    dm_keyword: 'Someone sends you a DM with a keyword',
    story_reply: 'Someone replies to or reacts to your story',
    any_dm: 'Any DM that no other automation answers',
    ice_breaker: 'Tappable questions shown when someone opens a new chat',
  }[trigger.type]

  return (
    <Section index={1} title="When this happens" subtitle={subtitle} issues={issues('trigger')}>
      <Segmented
        value={trigger.type}
        onChange={(type) => update((d) => void (d.trigger = changeTriggerType(d.trigger, type)))}
        options={TRIGGER_OPTIONS.map((o) => ({
          value: o.value,
          label: o.label,
          disabled: o.instagramOnly && platform !== 'instagram',
        }))}
      />

      {trigger.type === 'comment_keyword' && (
        <div>
          <Label>Which posts</Label>
          <div className="flex flex-wrap gap-2">
            {POSTS.map((post) => {
              const selected = trigger.posts.mode === 'specific' && trigger.posts.mediaIds.includes(post.id)
              return (
                <button
                  key={post.id}
                  type="button"
                  title={post.label}
                  onClick={() =>
                    update((d) => {
                      if (d.trigger.type !== 'comment_keyword') return
                      const current = d.trigger.posts.mode === 'specific' ? d.trigger.posts.mediaIds : []
                      const mediaIds = current.includes(post.id) ? current.filter((id) => id !== post.id) : [...current, post.id]
                      d.trigger.posts = mediaIds.length > 0 ? { mode: 'specific', mediaIds } : { mode: 'any' }
                    })
                  }
                  className={cx(
                    'size-14 rounded-xl border-2 transition-all',
                    post.style,
                    selected ? 'border-brand ring-3 ring-brand-soft' : 'border-transparent opacity-80 hover:opacity-100',
                  )}
                />
              )
            })}
            {(['any', 'next'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => update((d) => d.trigger.type === 'comment_keyword' && void (d.trigger.posts = { mode }))}
                className={cx(
                  'h-14 rounded-xl border px-4 text-[13px] font-medium transition-colors',
                  trigger.posts.mode === mode ? 'border-brand bg-brand-tint text-ink' : 'border-line text-muted hover:border-faint',
                )}
              >
                {mode === 'any' ? 'Any post or reel' : 'My next post'}
              </button>
            ))}
          </div>
        </div>
      )}

      {(trigger.type === 'comment_keyword' || trigger.type === 'dm_keyword') && (
        <div>
          <Label
            hint={
              <button
                type="button"
                className="hover:text-ink"
                onClick={() =>
                  update((d) => {
                    if (d.trigger.type === 'comment_keyword' || d.trigger.type === 'dm_keyword') {
                      d.trigger.match = d.trigger.match === 'contains' ? 'exact' : 'contains'
                    }
                  })
                }
              >
                {trigger.match === 'contains' ? 'Message contains a keyword' : 'Message is exactly a keyword'} ·{' '}
                <span className="underline">change</span>
              </button>
            }
          >
            Keywords
          </Label>
          <KeywordInput
            value={trigger.keywords}
            placeholder={trigger.type === 'comment_keyword' ? 'Any comment' : undefined}
            onChange={(keywords) =>
              update((d) => {
                if (d.trigger.type === 'comment_keyword' || d.trigger.type === 'dm_keyword') d.trigger.keywords = keywords
              })
            }
          />
          {trigger.type === 'comment_keyword' && trigger.keywords.length === 0 && (
            <p className="mt-1.5 text-[12.5px] text-subtle">
              No keywords: replies to every comment on these posts, unless another automation matches its keyword first.
            </p>
          )}
        </div>
      )}

      {trigger.type === 'story_reply' && (
        <>
          <label className="flex items-center gap-3 text-[14px]">
            <Toggle
              label="Include reactions"
              checked={trigger.includeReactions}
              onChange={(value) => update((d) => d.trigger.type === 'story_reply' && void (d.trigger.includeReactions = value))}
            />
            Also trigger on emoji reactions
          </label>
          <div>
            <Label hint="Leave empty to reply to every story reply">Only when the reply contains</Label>
            <KeywordInput
              value={trigger.keywords}
              placeholder="Any reply"
              onChange={(keywords) => update((d) => d.trigger.type === 'story_reply' && void (d.trigger.keywords = keywords))}
            />
          </div>
        </>
      )}

      {trigger.type === 'ice_breaker' && (
        <div className="flex flex-col gap-3">
          {trigger.items.map((item, index) => (
            <div key={index} className="rounded-2xl border border-line bg-sand/50 p-3.5">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex-1">
                  <TextInput
                    value={item.question}
                    maxLength={80}
                    placeholder="Question people can tap"
                    onChange={(question) =>
                      update((d) => {
                        if (d.trigger.type === 'ice_breaker' && d.trigger.items[index]) d.trigger.items[index].question = question
                      })
                    }
                  />
                </div>
                {trigger.items.length > 1 && (
                  <button
                    type="button"
                    aria-label="Remove question"
                    className="grid size-10 place-items-center rounded-xl text-subtle hover:bg-white hover:text-ink"
                    onClick={() => update((d) => d.trigger.type === 'ice_breaker' && void d.trigger.items.splice(index, 1))}
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
              <MessageInput
                value={item.answer}
                rows={2}
                maxLength={1000}
                placeholder="Instant answer"
                onChange={(answer) =>
                  update((d) => {
                    if (d.trigger.type === 'ice_breaker' && d.trigger.items[index]) d.trigger.items[index].answer = answer
                  })
                }
                footer={
                  <LinkButtons
                    links={item.links}
                    onChange={(links) =>
                      update((d) => {
                        if (d.trigger.type === 'ice_breaker' && d.trigger.items[index]) d.trigger.items[index].links = links
                      })
                    }
                  />
                }
              />
            </div>
          ))}
          {trigger.items.length < 4 && (
            <AddButton
              onClick={() =>
                update((d) => d.trigger.type === 'ice_breaker' && void d.trigger.items.push({ question: '', answer: '', links: [] }))
              }
            >
              Add question ({trigger.items.length}/4)
            </AddButton>
          )}
        </div>
      )}
    </Section>
  )
}

export function PublicReplySection({
  recipe,
  update,
  issues,
}: {
  recipe: Recipe
  update: Update
  issues: (section: RecipeSection) => RecipeIssue[]
}) {
  const { trigger } = recipe
  if (trigger.type !== 'comment_keyword') return null
  const { enabled, replies } = trigger.publicReplies
  const set = (fn: (publicReplies: { enabled: boolean; replies: string[] }) => void) =>
    update((d) => d.trigger.type === 'comment_keyword' && void fn(d.trigger.publicReplies))

  return (
    <Section
      index={2}
      title="Reply publicly under the comment"
      subtitle={enabled ? `Rotates ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'} so it looks human` : 'Off — they only get the DM'}
      issues={issues('publicReply')}
      action={<Toggle label="Reply publicly" checked={enabled} onChange={(value) => set((p) => void (p.enabled = value))} />}
    >
      {enabled && (
        <div className="grid gap-2 sm:grid-cols-2">
          {replies.map((reply, index) => (
            <div key={index} className="flex items-center gap-1">
              <div className="flex-1">
                <TextInput value={reply} maxLength={500} onChange={(value) => set((p) => void (p.replies[index] = value))} />
              </div>
              {replies.length > 1 && (
                <button
                  type="button"
                  aria-label="Remove reply"
                  className="grid size-9 place-items-center rounded-lg text-faint hover:text-ink"
                  onClick={() => set((p) => void p.replies.splice(index, 1))}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
          {replies.length < 10 && <AddButton onClick={() => set((p) => void p.replies.push(''))}>Add variation</AddButton>}
        </div>
      )}
    </Section>
  )
}

export function DmSection({
  index,
  recipe,
  update,
  issues,
}: {
  index: number
  recipe: Recipe
  update: Update
  issues: (section: RecipeSection) => RecipeIssue[]
}) {
  if (recipe.trigger.type === 'ice_breaker') return null
  const required = openerRequired(recipe.trigger)
  const opener = recipe.opener.enabled || required
  const { links } = recipe.message

  return (
    <Section
      index={index}
      title="Send this DM"
      subtitle={[opener && 'Opener + tap to continue', 'Message', links.length > 0 && `${links.length} link button${links.length > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}
      issues={issues('dm')}
    >
      <div>
        <Label
          hint={
            required ? (
              'Required for comments — Meta allows one DM until they reply'
            ) : (
              <span className="flex items-center gap-2">
                Ask them to tap first
                <Toggle label="Opener" checked={recipe.opener.enabled} onChange={(v) => update((d) => void (d.opener.enabled = v))} />
              </span>
            )
          }
        >
          Opening message
        </Label>
        {opener && (
          <MessageInput
            value={recipe.opener.text}
            maxLength={640}
            rows={2}
            onChange={(text) => update((d) => void (d.opener.text = text))}
            footer={
              <ButtonField
                icon={<span className="text-[13px]">↳</span>}
                value={recipe.opener.buttonLabel}
                placeholder="Button label"
                onChange={(label) => update((d) => void (d.opener.buttonLabel = label))}
              />
            }
          />
        )}
      </div>

      <div>
        <Label hint={opener ? 'Sent after they tap' : undefined}>{opener ? 'Then send' : 'Message'}</Label>
        <MessageInput
          value={recipe.message.text}
          maxLength={links.length > 0 ? 640 : 1000}
          onChange={(text) => update((d) => void (d.message.text = text))}
          footer={<LinkButtons links={links} onChange={(next) => update((d) => void (d.message.links = next))} />}
        />
        <div className="mt-3">
          <Label hint="Sent as a picture just before the message">Image (optional)</Label>
          <TextInput
            value={recipe.message.imageUrl}
            placeholder="https://… link to a .jpg or .png"
            onChange={(imageUrl) => update((d) => void (d.message.imageUrl = imageUrl.trim()))}
          />
        </div>
      </div>
    </Section>
  )
}

export function BoostersSection({
  index,
  recipe,
  update,
  platform,
  issues,
}: {
  index: number
  recipe: Recipe
  update: Update
  platform: Platform
  issues: (section: RecipeSection) => RecipeIssue[]
}) {
  if (recipe.trigger.type === 'ice_breaker') return null
  const collect = recipe.collect.kind
  const setCollect = (kind: 'email' | 'phone') =>
    update((d) => {
      d.collect = d.collect.kind === kind ? { ...d.collect, kind: 'none' } : { kind, ...COLLECT_DEFAULTS[kind] }
      if (d.collect.kind !== 'none') {
        const tag = `${kind}-lead`
        if (!d.tags.includes(tag)) d.tags.push(tag)
      }
    })

  const canNudge = nudgeApplies(recipe)
  const active = [
    recipe.followGate.enabled && 'Follow gate',
    collect !== 'none' && `Ask for ${collect}`,
    canNudge && recipe.nudge.enabled && 'Reminder',
    recipe.tags.length > 0 && 'Tags',
  ]
  return (
    <Section
      index={index}
      title="Boosters"
      subtitle={active.filter(Boolean).join(' · ') || 'Optional extras that grow your audience'}
      issues={issues('boosters')}
    >
      <div className="grid gap-2.5 sm:grid-cols-3">
        <Booster
          icon={<UserPlus className="size-4" />}
          title="Follow gate"
          body={platform === 'instagram' ? 'Ask for a follow first' : 'Instagram only'}
          checked={recipe.followGate.enabled}
          disabled={platform !== 'instagram'}
          onChange={(v) => update((d) => void (d.followGate.enabled = v))}
        />
        <Booster
          icon={<AtSign className="size-4" />}
          title="Ask for email"
          body="Saved as a lead"
          checked={collect === 'email'}
          onChange={() => setCollect('email')}
        />
        <Booster
          icon={<Phone className="size-4" />}
          title="Ask for phone"
          body="Saved as a lead"
          checked={collect === 'phone'}
          onChange={() => setCollect('phone')}
        />
      </div>

      {recipe.followGate.enabled && (
        <div>
          <Label hint="Sent when they aren't following yet">Follow gate message</Label>
          <MessageInput
            value={recipe.followGate.text}
            maxLength={640}
            rows={2}
            onChange={(text) => update((d) => void (d.followGate.text = text))}
            footer={
              <ButtonField
                icon={<span className="text-[13px]">↳</span>}
                value={recipe.followGate.buttonLabel}
                placeholder="Button label"
                onChange={(label) => update((d) => void (d.followGate.buttonLabel = label))}
              />
            }
          />
          <div className="mt-3">
            <Label hint="Sent if they tap the button but still aren't following">Follow reminder</Label>
            <MessageInput
              value={recipe.followGate.reminderText}
              maxLength={640}
              rows={2}
              onChange={(text) => update((d) => void (d.followGate.reminderText = text))}
            />
          </div>
        </div>
      )}

      {collect !== 'none' && (
        <div className="grid gap-3">
          <div>
            <Label hint="Skipped if we already have it">Question</Label>
            <MessageInput value={recipe.collect.question} maxLength={1000} rows={2} onChange={(q) => update((d) => void (d.collect.question = q))} />
          </div>
          <div>
            <Label hint="2 tries · waits 24h">If the answer isn't valid</Label>
            <TextInput value={recipe.collect.retryText} maxLength={1000} onChange={(t) => update((d) => void (d.collect.retryText = t))} />
          </div>
        </div>
      )}

      <Booster
        icon={<BellRing className="size-4" />}
        title="Remind them once"
        body={
          canNudge
            ? 'Nudge people who stop before tapping or answering'
            : 'Needs an opener, follow gate or email/phone question (comments allow no reminder on the first message)'
        }
        checked={canNudge && recipe.nudge.enabled}
        disabled={!canNudge}
        onChange={(v) => update((d) => void (d.nudge.enabled = v))}
      />

      {canNudge && recipe.nudge.enabled && (
        <div>
          <Label hint={`Sent once · max ${MAX_NUDGE_HOURS}h, inside Meta's 24h messaging window`}>Reminder message</Label>
          <MessageInput
            value={recipe.nudge.text}
            maxLength={1000}
            rows={2}
            onChange={(text) => update((d) => void (d.nudge.text = text))}
            footer={
              <span className="flex items-center gap-2 text-[13px] text-muted">
                Send after
                <input
                  type="number"
                  min={1}
                  max={MAX_NUDGE_HOURS}
                  value={recipe.nudge.afterHours}
                  onChange={(e) =>
                    update((d) => {
                      const hours = Math.round(Number(e.target.value))
                      d.nudge.afterHours = Number.isFinite(hours) ? Math.min(MAX_NUDGE_HOURS, Math.max(1, hours)) : 1
                    })
                  }
                  className="h-7 w-14 rounded-lg border border-line bg-white px-2 text-center text-[13px] text-ink outline-none focus:border-ink"
                />
                hours without a reply
              </span>
            }
          />
        </div>
      )}

      <div>
        <Label hint="Added when the flow finishes">
          <span className="inline-flex items-center gap-1.5">
            <Tag className="size-3.5" /> Tag contacts
          </span>
        </Label>
        <KeywordInput value={recipe.tags} placeholder="e.g. vip, email-lead" onChange={(tags) => update((d) => void (d.tags = tags))} />
      </div>
    </Section>
  )
}

function Booster({
  icon,
  title,
  body,
  checked,
  disabled,
  onChange,
}: {
  icon: ReactNode
  title: string
  body: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div
      className={cx(
        'flex items-center gap-3 rounded-2xl p-3.5 transition-colors',
        checked ? 'bg-brand-soft' : 'bg-sand',
        disabled && 'opacity-60',
      )}
    >
      <span className={checked ? 'text-brand' : 'text-muted'}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold">{title}</span>
        <span className="block truncate text-[12px] text-muted">{body}</span>
      </span>
      <Toggle label={title} checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  )
}

function LinkButtons({ links, onChange }: { links: LinkButton[]; onChange: (links: LinkButton[]) => void }) {
  const change = (index: number, patch: Partial<LinkButton>) =>
    onChange(links.map((link, i) => (i === index ? { ...link, ...patch } : link)))
  return (
    <div className="flex flex-col gap-2">
      {links.map((link, index) => (
        <div key={index} className="flex items-center gap-2">
          <ButtonField
            icon={<Link2 className="size-3.5 text-brand" />}
            value={link.label}
            placeholder="Button label"
            onChange={(label) => change(index, { label })}
          />
          <span className="text-faint">→</span>
          <input
            value={link.url}
            placeholder="https://"
            onChange={(e) => change(index, { url: e.target.value })}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-muted outline-none placeholder:text-faint"
          />
          <button
            type="button"
            aria-label="Remove link"
            className="text-faint hover:text-ink"
            onClick={() => onChange(links.filter((_, i) => i !== index))}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
      {links.length < MAX_LINKS && (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-muted hover:text-ink"
          onClick={() => onChange([...links, { label: '', url: '' }])}
        >
          <Plus className="size-3.5" /> Add link button{links.length > 0 ? ` (${links.length}/${MAX_LINKS})` : ''}
        </button>
      )}
    </div>
  )
}

function ButtonField({
  icon,
  value,
  placeholder,
  onChange,
}: {
  icon: ReactNode
  value: string
  placeholder: string
  onChange: (value: string) => void
}) {
  return (
    <span
      className={cx(
        'inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold',
        value.length > 20 ? 'bg-brand-soft text-[#a12b0b]' : 'bg-brand-tint text-ink',
      )}
    >
      {icon}
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        size={Math.max(8, value.length + 1)}
        className="bg-transparent outline-none placeholder:font-normal placeholder:text-faint"
      />
    </span>
  )
}

function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-dashed border-faint px-3 text-[13px] font-medium text-muted hover:border-ink hover:text-ink"
    >
      <Plus className="size-3.5" /> {children}
    </button>
  )
}
