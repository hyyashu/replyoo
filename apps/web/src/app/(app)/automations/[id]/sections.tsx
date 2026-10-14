'use client'

import { useDashboardError } from '@/i18n/use-errors'
import { useTranslations } from 'next-intl'

import type { Platform } from '@replyooo/shared'
import { ArrowDown, ArrowUp, AtSign, BellRing, ChevronDown, CircleAlert, Link2, Phone, Plus, Tag, Trash2, UserPlus } from 'lucide-react'
import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { Toggle, cx } from '@/components/ui'
import {
  EMPTY_CARD,
  MAX_CARDS,
  MAX_LINKS,
  MAX_NUDGE_HOURS,
  changeTriggerType,
  normalizeUrl,
  nudgeApplies,
  openerRequired,
  setCollectKind,
  TAG_LIMITS,
  type CardInput,
  type LinkButton,
  type Recipe,
  type RecipeTrigger,
} from '@/lib/recipe'
import type { RecipeIssue, RecipeSection } from '@/lib/validation'
import { COMMENT_VARIABLES, KeywordInput, Label, MessageInput, Segmented, TextInput } from './fields'
import type { RecentPost } from '@/lib/data'
import { PostPickerDialog } from './post-picker'

export type Update = (fn: (draft: Recipe) => void) => void

// One section is open at a time, so a newcomer sees a single step instead of every option at once.
const AccordionContext = createContext<{ open: string; setOpen: (id: string) => void }>({ open: '', setOpen: () => {} })

export function Accordion({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<string>('trigger')
  return <AccordionContext.Provider value={{ open, setOpen }}>{children}</AccordionContext.Provider>
}

/** Segmented "n of m ready" bar; each segment opens its section. */
export function ProgressCue({ steps }: { steps: { id: RecipeSection; label: string; ready: boolean }[] }) {
  const tr = useTranslations('automations')
  
  const { setOpen } = useContext(AccordionContext)
  const done = steps.filter((step) => step.ready).length
  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-1" role="group" aria-label={tr('setup_progress')}>
        {steps.map((step) => (
          <button
            key={step.id}
            type="button"
            title={tr('setupStep', { label: step.label, ready: step.ready ? 'yes' : 'no' })}
            aria-label={tr('setupStep', { label: step.label, ready: step.ready ? 'yes' : 'no' })}
            onClick={() => setOpen(step.id)}
            className={cx('h-1.5 w-8 rounded-full transition-colors', step.ready ? 'bg-lime' : 'bg-white/25 hover:bg-white/40')}
          />
        ))}
      </div>
      <span className="text-[13px] font-semibold">{tr('setupReady', { done, total: steps.length })}</span>
    </div>
  )
}

function Section({
  id,
  index,
  title,
  subtitle,
  summary,
  issues,
  action,
  children,
}: {
  id: RecipeSection
  index: number
  title: string
  subtitle: string
  /** Shown instead of the subtitle while collapsed, so each step shows what was chosen. */
  summary?: string
  issues: RecipeIssue[]
  action?: ReactNode
  children?: ReactNode
}) {
  const tr = useTranslations('automations')
  const translateError = useDashboardError()
  const accordion = useContext(AccordionContext)
  const open = accordion.open === id
  const setOpen = (next: boolean) => accordion.setOpen(next ? id : '')
  return (
    <section className={cx('rounded-[20px] border bg-white transition-colors', issues.length > 0 ? 'border-[#ffb59a]' : 'border-line')}>
      <header className="flex items-center gap-3.5 px-5 py-4">
        <span className="grid size-[26px] shrink-0 place-items-center rounded-lg bg-ink font-mono text-[12px] font-semibold text-white">{index}</span>
        <button type="button" onClick={() => children && setOpen(!open)} className="min-w-0 flex-1 text-left">
          <h2 className="text-[15.5px] font-semibold">{title}</h2>
          <p className="truncate text-[12.5px] text-subtle">{!open && summary ? summary : subtitle}</p>
        </button>
        {action}
        {children && (
          <button type="button" onClick={() => setOpen(!open)} aria-label={open ? tr('collapse') : tr('expand')}>
            <ChevronDown className={cx('size-4 text-subtle transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </header>
      {open && children && <div className="flex flex-col gap-4 px-5 pb-5 sm:pl-[62px]">{children}</div>}
      {issues.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-[#ffd7c4] bg-brand-tint px-5 py-3 sm:pl-[62px]">
          {issues.map((issue) => (
            <li key={translateError(issue.message)} className="flex items-start gap-2 text-[13px] text-[#a12b0b]">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              {translateError(issue.message)}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function TriggerSection({
  recipe,
  update,
  platform,
  accountId,
  onMedia,
  issues,
}: {
  recipe: Recipe
  update: Update
  platform: Platform
  accountId: string
  onMedia?: (posts: RecentPost[]) => void
  issues: (section: RecipeSection) => RecipeIssue[]
}) {
  const tr = useTranslations('automations')
  
  const TRIGGER_OPTIONS: { value: RecipeTrigger['type']; label: string; instagramOnly?: boolean }[] = [
    { value: 'comment_keyword', label: tr('comment') },
    { value: 'dm_keyword', label: tr('dm_keyword') },
    { value: 'story_reply', label: tr('story_reply'), instagramOnly: true },
    { value: 'any_dm', label: tr('any_dm') },
    { value: 'ice_breaker', label: tr('starters') },
  ]
  const { trigger } = recipe
  // Switching trigger type keeps what was entered, so switching back restores it.
  const previous = useRef<Partial<Record<RecipeTrigger['type'], RecipeTrigger>>>({})
  const [pickingPosts, setPickingPosts] = useState(false)
  const [pickingStories, setPickingStories] = useState(false)
  // Same idea as anyComment: no keywords means any reply, and this remembers a choice of "specific keywords" before any are typed.
  const [storyAnyWord, setStoryAnyWord] = useState(() => trigger.type === 'story_reply' && trigger.keywords.length === 0)
  // An empty keyword list means "any comment"; this remembers an explicit choice of "specific keywords" before any are typed.
  const [anyComment, setAnyComment] = useState(() => trigger.type === 'comment_keyword' && trigger.keywords.length === 0)
  const commentsAny = trigger.type === 'comment_keyword' && trigger.keywords.length === 0 && anyComment
  const subtitle = {
    comment_keyword: tr('someone_comments_on_your_post_with_a_keyword_or_any_comment'),
    dm_keyword: tr('someone_sends_you_a_dm_with_a_keyword'),
    story_reply: tr('someone_replies_to_or_reacts_to_your_story'),
    any_dm: tr('any_dm_that_no_other_automation_answers'),
    ice_breaker: tr('tappable_questions_shown_when_someone_opens_a_new_chat'),
  }[trigger.type]

  const title = {
    comment_keyword: tr('when_someone_comments'),
    dm_keyword: tr('when_someone_dms_you_a_keyword'),
    story_reply: tr('when_someone_replies_to_your_story'),
    any_dm: tr('when_someone_dms_you'),
    ice_breaker: tr('when_someone_opens_a_new_chat'),
  }[trigger.type]
  const keywordSummary = (keywords: string[], none: string) => (keywords.length ? tr('keywordsSummary', { keywords: keywords.join(', ') }) : none)
  const summary = {
    comment_keyword:
      trigger.type === 'comment_keyword'
        ? [
            trigger.posts.mode === 'any'
              ? tr('any_post_or_reel')
              : trigger.posts.mode === 'next'
                ? tr('your_next_post')
                : tr('postsChosen', { count: trigger.posts.mediaIds.length }),
            keywordSummary(trigger.keywords, tr('any_comment')),
          ].join(' · ')
        : '',
    dm_keyword: trigger.type === 'dm_keyword' ? keywordSummary(trigger.keywords, tr('any_dm')) : '',
    story_reply:
      trigger.type === 'story_reply'
        ? [
            trigger.stories.mode === 'any' ? tr('any_story') : tr('storiesChosen', { count: trigger.stories.mediaIds.length }),
            trigger.includeReactions ? tr('replies_and_reactions') : tr('replies_only'),
            keywordSummary(trigger.keywords, tr('any_word')),
          ].join(' · ')
        : '',
    any_dm: tr('any_dm_that_no_other_automation_answers'),
    ice_breaker: trigger.type === 'ice_breaker' ? tr('questionsCount', { count: trigger.items.length }) : '',
  }[trigger.type]

  return (
    <Section id="trigger" index={1} title={title} subtitle={subtitle} summary={summary} issues={issues('trigger')}>
      <Segmented
        value={trigger.type}
        onChange={(type) => {
          previous.current[trigger.type] = structuredClone(trigger)
          const restored = previous.current[type]
          update((d) => void (d.trigger = restored ? structuredClone(restored) : changeTriggerType(d.trigger, type)))
        }}
        options={TRIGGER_OPTIONS.map((o) => ({
          value: o.value,
          label: o.label,
          disabled: o.instagramOnly && platform !== 'instagram',
        }))}
      />

      {trigger.type === 'comment_keyword' && (
        <div>
          <Label>{tr('which_posts')}</Label>
          <Segmented
            value={trigger.posts.mode}
            onChange={(mode) => {
              update((d) => {
                if (d.trigger.type !== 'comment_keyword') return
                const mediaIds = d.trigger.posts.mode === 'specific' ? d.trigger.posts.mediaIds : []
                d.trigger.posts = mode === 'specific' ? { mode, mediaIds } : { mode }
              })
              if (mode === 'specific') setPickingPosts(true)
            }}
            options={[
              { value: 'any', label: tr('any_post_or_reel') },
              { value: 'next', label: tr('my_next_post') },
              { value: 'specific', label: tr('specific_posts') },
            ]}
          />
          {trigger.posts.mode === 'specific' && (
            <>
              <p className="mt-2 flex flex-wrap items-center gap-x-3 text-[12.5px] text-subtle">
                {trigger.posts.mediaIds.length === 0 ? tr('no_posts_chosen_yet') : tr('chosenPostsDetails', { count: trigger.posts.mediaIds.length })}
                <button type="button" className="font-medium text-ink underline" onClick={() => setPickingPosts(true)}>
                  {trigger.posts.mediaIds.length === 0 ? tr('choose_posts') : tr('change')}
                </button>
              </p>
              {pickingPosts && (
                <PostPickerDialog
                  accountId={accountId}
                  onLoaded={onMedia}
                  selected={trigger.posts.mediaIds}
                  onChange={(mediaIds) =>
                    update((d) => d.trigger.type === 'comment_keyword' && void (d.trigger.posts = { mode: 'specific', mediaIds }))
                  }
                  onClose={() => setPickingPosts(false)}
                />
              )}
            </>
          )}
        </div>
      )}

      {(trigger.type === 'comment_keyword' || trigger.type === 'dm_keyword') && (
        <div>
          <Label
            hint={
              (trigger.type === 'dm_keyword' || !commentsAny) && (
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
                  {trigger.match === 'contains' ? tr('message_contains_a_keyword') : tr('message_is_exactly_a_keyword')} ·{' '}
                  <span className="underline">{tr('change_2')}</span>
                </button>
              )
            }
          >
            {trigger.type === 'comment_keyword' ? tr('and_this_comment_has') : tr('keywords')}
          </Label>
          {trigger.type === 'comment_keyword' && (
            <div className="mb-2.5">
              <Segmented
                value={commentsAny ? tr('any') : tr('specific')}
                onChange={(mode) => {
                  setAnyComment(mode === 'any')
                  if (mode === 'any') update((d) => d.trigger.type === 'comment_keyword' && void (d.trigger.keywords = []))
                }}
                options={[
                  { value: 'specific', label: tr('specific_keywords') },
                  { value: 'any', label: tr('any_comment') },
                ]}
              />
            </div>
          )}
          {commentsAny ? (
            <p className="text-[12.5px] text-subtle">{tr('replies_to_every_comment_on_these_posts_unless_another_automation_matches')}</p>
          ) : (
            <>
              <KeywordInput
                label={tr('keywords')}
                ignoresCase
                value={trigger.keywords}
                placeholder={trigger.type === 'comment_keyword' ? tr('type_a_keyword_and_press_enter_e_g_link_price') : undefined}
                onChange={(keywords) =>
                  update((d) => {
                    if (d.trigger.type === 'comment_keyword' || d.trigger.type === 'dm_keyword') d.trigger.keywords = keywords
                  })
                }
              />
              {trigger.type === 'comment_keyword' && trigger.keywords.length === 0 && (
                <p className="mt-1.5 text-[12.5px] text-subtle">{tr('add_a_keyword_or_choose_any_comment')}</p>
              )}
            </>
          )}
        </div>
      )}

      {trigger.type === 'story_reply' && (
        <>
          <div>
            <Label>{tr('which_stories')}</Label>
            <Segmented
              value={trigger.stories.mode}
              onChange={(mode) => {
                update((d) => {
                  if (d.trigger.type !== 'story_reply') return
                  const mediaIds = d.trigger.stories.mode === 'specific' ? d.trigger.stories.mediaIds : []
                  d.trigger.stories = mode === 'specific' ? { mode, mediaIds } : { mode }
                })
                if (mode === 'specific') setPickingStories(true)
              }}
              options={[
                { value: 'any', label: tr('any_story') },
                { value: 'specific', label: tr('a_specific_story') },
              ]}
            />
            {trigger.stories.mode === 'specific' && (
              <>
                <p className="mt-2 flex flex-wrap items-center gap-x-3 text-[12.5px] text-subtle">
                  {trigger.stories.mediaIds.length === 0
                    ? tr('no_story_chosen_yet')
                    : tr('chosen', { v0: trigger.stories.mediaIds.length, v1: trigger.stories.mediaIds.length === 1 ? 'story' : 'stories' })}
                  <button type="button" className="font-medium text-ink underline" onClick={() => setPickingStories(true)}>
                    {trigger.stories.mediaIds.length === 0 ? tr('choose_a_story') : tr('change')}
                  </button>
                </p>
                <p className="mt-1 text-[12.5px] text-subtle">{tr('only_your_live_stories_can_be_picked_and_this_stops_matching')}</p>
                {pickingStories && (
                  <PostPickerDialog
                    source="stories"
                    accountId={accountId}
                    onLoaded={onMedia}
                    selected={trigger.stories.mediaIds}
                    onChange={(mediaIds) =>
                      update((d) => d.trigger.type === 'story_reply' && void (d.trigger.stories = { mode: 'specific', mediaIds }))
                    }
                    onClose={() => setPickingStories(false)}
                  />
                )}
              </>
            )}
            {trigger.stories.mode === 'any' && (
              <p className="mt-2 text-[12.5px] text-subtle">{tr('a_story_you_pick_specifically_wins_over_this_one_when_both')}</p>
            )}
          </div>

          <div>
            <Label>{tr('and_this_reply_has')}</Label>
            <Segmented
              value={storyAnyWord ? tr('any') : tr('keywords_2')}
              onChange={(mode) => {
                setStoryAnyWord(mode === 'any')
                if (mode === 'any') update((d) => d.trigger.type === 'story_reply' && void (d.trigger.keywords = []))
              }}
              options={[
                { value: 'any', label: tr('any_word_or_reaction') },
                { value: 'keywords', label: tr('specific_keywords') },
              ]}
            />
            {!storyAnyWord && (
              <div className="mt-2.5">
                <KeywordInput
                  label={tr('only_when_the_reply_contains')}
                  ignoresCase
                  value={trigger.keywords}
                  placeholder={tr('add_a_keyword')}
                  onChange={(keywords) => update((d) => d.trigger.type === 'story_reply' && void (d.trigger.keywords = keywords))}
                />
                {trigger.keywords.length === 0 && (
                  <p className="mt-1.5 text-[12.5px] text-subtle">{tr('add_a_keyword_or_choose_any_word_or_reaction')}</p>
                )}
              </div>
            )}
          </div>

          <label className="flex items-center gap-3 text-[14px]">
            <Toggle
              label={tr('include_reactions')}
              checked={trigger.includeReactions}
              onChange={(value) => update((d) => d.trigger.type === 'story_reply' && void (d.trigger.includeReactions = value))}
            />
            {tr('also_trigger_on_emoji_reactions')}{' '}
          </label>
          <label className="flex items-center gap-3 text-[14px]">
            <Toggle
              label={tr('react_with_a_heart')}
              checked={trigger.reactWithHeart}
              onChange={(value) => update((d) => d.trigger.type === 'story_reply' && void (d.trigger.reactWithHeart = value))}
            />
            {tr('react_to_their_reply_with')}{' '}
          </label>
        </>
      )}

      {trigger.type === 'ice_breaker' && (
        <div className="flex flex-col gap-3">
          {trigger.items.map((item, index) => (
            <div key={index} className="rounded-2xl border border-line bg-sand/50 p-3.5">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex-1">
                  <TextInput
                    label={tr('question_people_can_tap')}
                    value={item.question}
                    maxLength={80}
                    placeholder={tr('question_people_can_tap')}
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
                    aria-label={tr('remove_question')}
                    className="grid size-10 place-items-center rounded-xl text-subtle hover:bg-white hover:text-ink"
                    onClick={() => update((d) => d.trigger.type === 'ice_breaker' && void d.trigger.items.splice(index, 1))}
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
              <MessageInput
                label={tr('instant_answer')}
                value={item.answer}
                rows={2}
                maxLength={1000}
                placeholder={tr('instant_answer')}
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
                update(
                  (d) =>
                    d.trigger.type === 'ice_breaker' &&
                    void d.trigger.items.push({
                      question: '',
                      answer: '',
                      links: [],
                    }),
                )
              }
            >
              {tr('add_question_4', { v0: trigger.items.length })}
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
  const tr = useTranslations('automations')
  
  const { trigger } = recipe
  if (trigger.type !== 'comment_keyword') return null
  const { enabled, replies } = trigger.publicReplies
  const filled = replies.filter((reply) => reply.trim() !== '').length
  const set = (fn: (publicReplies: { enabled: boolean; replies: string[] }) => void) =>
    update((d) => d.trigger.type === 'comment_keyword' && void fn(d.trigger.publicReplies))

  return (
    <Section
      id="publicReply"
      index={2}
      title={tr('reply_under_their_comment')}
      subtitle={
        enabled
          ? filled === 0
            ? tr('add_at_least_one_reply_or_turn_this_off')
            : tr('repliesRotation', { count: filled })
          : tr('off_they_only_get_the_dm')
      }
      issues={issues('publicReply')}
      action={<Toggle label={tr('reply_publicly')} checked={enabled} onChange={(value) => set((p) => void (p.enabled = value))} />}
    >
      {enabled && (
        <div className="grid gap-2">
          {replies.map((reply, index) => (
            <div key={index} className="flex items-start gap-1">
              <div className="flex-1">
                <MessageInput
                  label={tr('public_reply', { v0: index + 1 })}
                  value={reply}
                  rows={2}
                  maxLength={500}
                  variables={COMMENT_VARIABLES}
                  onChange={(value) => set((p) => void (p.replies[index] = value))}
                />
              </div>
              {replies.length > 1 && (
                <button
                  type="button"
                  aria-label={tr('remove_reply')}
                  className="mt-1 grid size-9 place-items-center rounded-lg text-faint hover:text-ink"
                  onClick={() => set((p) => void p.replies.splice(index, 1))}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
          {replies.length < 10 && <AddButton onClick={() => set((p) => void p.replies.push(''))}>{tr('add_variation')}</AddButton>}
        </div>
      )}
    </Section>
  )
}

export function DmSection({
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
  const tr = useTranslations('automations')
  
  if (recipe.trigger.type === 'ice_breaker') return null
  const required = openerRequired(recipe.trigger)
  const opener = recipe.opener.enabled || required
  const { links } = recipe.message
  const products = recipe.message.format === 'products'

  return (
    <Section
      id="dm"
      index={index}
      title={recipe.trigger.type === 'comment_keyword' ? tr('send_them_a_dm') : tr('send_them_a_reply')}
      subtitle={[opener && tr('opener_tap_to_continue'), tr('message_4'), (products ? tr('cardsCount', { count: (recipe.message.cards ?? []).length }) : links.length > 0 && tr('linksCount', { count: links.length }))]
        .filter(Boolean)
        .join(' · ')}
      issues={issues('dm')}
    >
      <div>
        <Label
          hint={
            required ? (
              tr('required_for_comments_meta_allows_one_dm_until_they_reply')
            ) : (
              <span className="flex items-center gap-2">
                {tr('ask_them_to_tap_first')}{' '}
                <Toggle label={tr('opener')} checked={recipe.opener.enabled} onChange={(v) => update((d) => void (d.opener.enabled = v))} />
              </span>
            )
          }
        >
          {tr('opening_message')}
        </Label>
        {opener && (
          <MessageInput
            label={tr('opening_message')}
            value={recipe.opener.text}
            maxLength={640}
            rows={2}
            onChange={(text) => update((d) => void (d.opener.text = text))}
            footer={
              <ButtonField
                label={tr('opener_button_label')}
                icon={<span className="text-[13px]">↳</span>}
                value={recipe.opener.buttonLabel}
                placeholder={tr('button_label')}
                onChange={(label) => update((d) => void (d.opener.buttonLabel = label))}
              />
            }
          />
        )}
      </div>

      <div>
        {platform === 'instagram' && (
          <div className="mb-3">
            <Segmented
              value={recipe.message.format ?? 'links'}
              options={[
                { value: 'links', label: tr('format_links') },
                { value: 'products', label: tr('format_products') },
              ]}
              onChange={(format) =>
                update((d) => {
                  d.message.format = format
                  if (format === 'products' && !d.message.cards?.length) d.message.cards = [{ ...EMPTY_CARD }]
                })
              }
            />
          </div>
        )}
        <Label hint={opener ? tr('sent_after_they_tap') : undefined}>
          {products ? tr('intro_optional') : opener ? tr('then_send') : tr('message_4')}
        </Label>
        <MessageInput
          label={products ? tr('intro_optional') : opener ? tr('then_send') : tr('message_4')}
          value={recipe.message.text}
          maxLength={!products && links.length > 0 ? 640 : 1000}
          onChange={(text) => update((d) => void (d.message.text = text))}
          footer={products ? undefined : <LinkButtons links={links} onChange={(next) => update((d) => void (d.message.links = next))} />}
        />
        {products ? (
          <CardsEditor cards={recipe.message.cards ?? []} onChange={(cards) => update((d) => void (d.message.cards = cards))} />
        ) : (
          <div className="mt-3">
            <Label hint={tr('sent_as_a_picture_just_before_the_message')}>{tr('image_optional')}</Label>
            <TextInput
              label={tr('image_optional')}
              value={recipe.message.imageUrl}
              placeholder={tr('https_link_to_a_jpg_or_png')}
              onChange={(imageUrl) => update((d) => void (d.message.imageUrl = imageUrl.trim()))}
              onBlur={(e) => update((d) => void (d.message.imageUrl = normalizeUrl(e.target.value)))}
            />
          </div>
        )}
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
  const tr = useTranslations('automations')
  
  if (recipe.trigger.type === 'ice_breaker') return null
  const collect = recipe.collect.kind
  const setCollect = (kind: 'email' | 'phone') => update((d) => setCollectKind(d, kind))

  const canNudge = nudgeApplies(recipe)
  const active = [
    recipe.followGate.enabled && tr('follow_gate'),
    collect !== 'none' && tr(collect === 'email' ? 'ask_for_email' : 'ask_for_phone'),
    canNudge && recipe.nudge.enabled && tr('reminder'),
    recipe.tags.length > 0 && tr('tags'),
  ]
  return (
    <Section
      id="boosters"
      index={index}
      title={tr('extras_optional')}
      subtitle={active.filter(Boolean).join(' · ') || tr('optional_extras_that_grow_your_audience')}
      issues={issues('boosters')}
    >
      <div className="grid gap-2.5 sm:grid-cols-3">
        <Booster
          icon={<UserPlus className="size-4" />}
          title={tr('follow_gate')}
          body={platform === 'instagram' ? tr('ask_for_a_follow_first') : tr('instagram_only')}
          checked={recipe.followGate.enabled}
          disabled={platform !== 'instagram'}
          onChange={(v) => update((d) => void (d.followGate.enabled = v))}
        />
        <Booster
          icon={<AtSign className="size-4" />}
          title={tr('ask_for_email')}
          body={tr('saved_as_a_lead')}
          checked={collect === 'email'}
          onChange={() => setCollect('email')}
        />
        <Booster
          icon={<Phone className="size-4" />}
          title={tr('ask_for_phone')}
          body={tr('saved_as_a_lead')}
          checked={collect === 'phone'}
          onChange={() => setCollect('phone')}
        />
      </div>

      {recipe.followGate.enabled && (
        <div>
          <Label hint={tr('sent_when_they_aren_t_following_yet')}>{tr('follow_gate_message')}</Label>
          <MessageInput
            label={tr('follow_gate_message')}
            value={recipe.followGate.text}
            maxLength={640}
            rows={2}
            onChange={(text) => update((d) => void (d.followGate.text = text))}
            footer={
              <ButtonField
                label={tr('follow_gate_button_label')}
                icon={<span className="text-[13px]">↳</span>}
                value={recipe.followGate.buttonLabel}
                placeholder={tr('button_label')}
                onChange={(label) => update((d) => void (d.followGate.buttonLabel = label))}
              />
            }
          />
          <div className="mt-3">
            <Label hint={tr('sent_if_they_tap_the_button_but_still_aren_t_following')}>{tr('follow_reminder')}</Label>
            <MessageInput
              label={tr('follow_reminder')}
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
            <Label hint={tr('skipped_if_we_already_have_it')}>{tr('question')}</Label>
            <MessageInput
              label={tr('question')}
              value={recipe.collect.question}
              maxLength={1000}
              rows={2}
              onChange={(q) => update((d) => void (d.collect.question = q))}
            />
          </div>
          <div>
            <Label hint={tr('2_tries_waits_24h')}>{tr('if_the_answer_isn_t_valid')}</Label>
            <TextInput
              label={tr('if_the_answer_isn_t_valid')}
              value={recipe.collect.retryText}
              maxLength={1000}
              onChange={(t) => update((d) => void (d.collect.retryText = t))}
            />
          </div>
        </div>
      )}

      <Booster
        icon={<BellRing className="size-4" />}
        title={tr('remind_them_once')}
        body={
          canNudge
            ? tr('nudge_people_who_stop_before_tapping_or_answering')
            : tr('needs_an_opener_follow_gate_or_email_phone_question_comments_allow')
        }
        checked={canNudge && recipe.nudge.enabled}
        disabled={!canNudge}
        onChange={(v) => update((d) => void (d.nudge.enabled = v))}
      />

      {canNudge && recipe.nudge.enabled && (
        <div>
          <Label hint={tr('sent_once_max_h_inside_meta_s_24h_messaging_window', { v0: MAX_NUDGE_HOURS })}>{tr('reminder_message')}</Label>
          <MessageInput
            label={tr('reminder_message')}
            value={recipe.nudge.text}
            maxLength={1000}
            rows={2}
            onChange={(text) => update((d) => void (d.nudge.text = text))}
            footer={
              <span className="flex items-center gap-2 text-[13px] text-muted">
                {tr('send_after')}{' '}
                <input
                  type="number"
                  aria-label={tr('hours_without_a_reply_before_the_reminder')}
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
                {tr('hours_without_a_reply')}{' '}
              </span>
            }
          />
        </div>
      )}

      <div>
        <Label hint={tr('added_when_the_flow_finishes')}>
          <span className="inline-flex items-center gap-1.5">
            <Tag className="size-3.5" /> {tr('tag_contacts')}{' '}
          </span>
        </Label>
        <KeywordInput
          label={tr('tag_contacts')}
          value={recipe.tags}
          placeholder={tr('e_g_vip_email_lead')}
          {...TAG_LIMITS}
          onChange={(tags) => update((d) => void (d.tags = tags))}
        />
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
      className={cx('flex items-center gap-3 rounded-2xl p-3.5 transition-colors', checked ? 'bg-brand-soft' : 'bg-sand', disabled && 'opacity-60')}
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
  const tr = useTranslations('automations')
  
  const change = (index: number, patch: Partial<LinkButton>) => onChange(links.map((link, i) => (i === index ? { ...link, ...patch } : link)))
  return (
    <div className="flex flex-col gap-2">
      {links.map((link, index) => (
        <div key={index} className="flex items-center gap-2">
          <ButtonField
            label={tr('link_button_label', { v0: index + 1 })}
            icon={<Link2 className="size-3.5 text-brand" />}
            value={link.label}
            placeholder={tr('button_label')}
            onChange={(label) => change(index, { label })}
          />
          <span className="text-faint">→</span>
          <input
            value={link.url}
            aria-label={tr('link_address', { v0: index + 1 })}
            placeholder={tr('https')}
            onChange={(e) => change(index, { url: e.target.value })}
            onBlur={(e) => change(index, { url: normalizeUrl(e.target.value) })}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-muted outline-none placeholder:text-faint"
          />
          <button
            type="button"
            aria-label={tr('remove_link')}
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
          <Plus className="size-3.5" /> {tr('add_link_button')} {links.length > 0 ? tr('message_5', { v0: links.length, v1: MAX_LINKS }) : ''}
        </button>
      )}
    </div>
  )
}

function CardsEditor({ cards, onChange }: { cards: CardInput[]; onChange: (cards: CardInput[]) => void }) {
  const tr = useTranslations('automations')
  const change = (index: number, patch: Partial<CardInput>) => onChange(cards.map((card, i) => (i === index ? { ...card, ...patch } : card)))
  const move = (index: number, by: -1 | 1) => {
    const next = [...cards]
    const [card] = next.splice(index, 1)
    next.splice(index + by, 0, card!)
    onChange(next)
  }
  return (
    <div className="mt-3 flex flex-col gap-3">
      <p className="text-[12.5px] text-subtle">{tr('cards_hint')}</p>
      {cards.map((card, index) => (
        <div key={index} className="flex flex-col gap-2 rounded-[14px] border border-line p-3">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-semibold">{tr('card_n', { v0: index + 1 })}</span>
            <span className="flex items-center gap-1">
              <button type="button" aria-label={tr('move_card_up')} disabled={index === 0} className="text-faint hover:text-ink disabled:opacity-30" onClick={() => move(index, -1)}>
                <ArrowUp className="size-3.5" />
              </button>
              <button type="button" aria-label={tr('move_card_down')} disabled={index === cards.length - 1} className="text-faint hover:text-ink disabled:opacity-30" onClick={() => move(index, 1)}>
                <ArrowDown className="size-3.5" />
              </button>
              <button type="button" aria-label={tr('remove_card')} disabled={cards.length === 1} className="text-faint hover:text-ink disabled:opacity-30" onClick={() => onChange(cards.filter((_, i) => i !== index))}>
                <Trash2 className="size-3.5" />
              </button>
            </span>
          </div>
          <TextInput label={tr('card_title', { v0: index + 1 })} value={card.title} maxLength={80} placeholder={tr('card_title_placeholder')} onChange={(title) => change(index, { title })} />
          <TextInput label={tr('card_subtitle', { v0: index + 1 })} value={card.subtitle} maxLength={80} placeholder={tr('card_subtitle_placeholder')} onChange={(subtitle) => change(index, { subtitle })} />
          <TextInput
            label={tr('card_image', { v0: index + 1 })}
            value={card.imageUrl}
            placeholder={tr('https_link_to_a_jpg_or_png')}
            onChange={(imageUrl) => change(index, { imageUrl: imageUrl.trim() })}
            onBlur={(e) => change(index, { imageUrl: normalizeUrl(e.target.value) })}
          />
          <div className="flex items-center gap-2">
            <ButtonField
              label={tr('card_button_label', { v0: index + 1 })}
              icon={<Link2 className="size-3.5 text-brand" />}
              value={card.buttonLabel}
              placeholder={tr('button_label')}
              onChange={(buttonLabel) => change(index, { buttonLabel })}
            />
            <span className="text-faint">→</span>
            <input
              value={card.buttonUrl}
              aria-label={tr('card_link', { v0: index + 1 })}
              placeholder={tr('https')}
              onChange={(e) => change(index, { buttonUrl: e.target.value })}
              onBlur={(e) => change(index, { buttonUrl: normalizeUrl(e.target.value) })}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-muted outline-none placeholder:text-faint"
            />
          </div>
        </div>
      ))}
      {cards.length < MAX_CARDS && (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-muted hover:text-ink"
          onClick={() => onChange([...cards, { ...EMPTY_CARD }])}
        >
          <Plus className="size-3.5" /> {tr('add_card')} ({cards.length}/{MAX_CARDS})
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
  label,
}: {
  icon: ReactNode
  value: string
  placeholder: string
  onChange: (value: string) => void
  /** Accessible name; pass the visible label text. */
  label?: string
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
        aria-label={label}
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
