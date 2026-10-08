import type { Button, FlowDefinition, Step, StepOf, Trigger } from '@replyooo/shared'

/**
 * The recipe form (spec §1.1): trigger → public reply → DM → toggleable boosters.
 * It compiles to the generic FlowDefinition the engine executes, and templates /
 * saved drafts decompile back into it.
 */
export type RecipeTrigger =
  | {
      type: 'comment_keyword'
      posts: TriggerOfType<'comment_keyword'>['posts']
      keywords: string[]
      match: 'contains' | 'exact'
      publicReplies: { enabled: boolean; replies: string[] }
    }
  | { type: 'dm_keyword'; keywords: string[]; match: 'contains' | 'exact' }
  | { type: 'story_reply'; includeReactions: boolean; keywords: string[] }
  | { type: 'any_dm' }
  | { type: 'ice_breaker'; items: { question: string; answer: string; links: LinkButton[] }[] }

export interface LinkButton {
  label: string
  url: string
}

/** Meta allows three buttons per message. */
export const MAX_LINKS = 3

type TriggerOfType<T extends Trigger['type']> = Extract<Trigger, { type: T }>

export interface Recipe {
  trigger: RecipeTrigger
  /** Message with a reply button sent first. Required for comment triggers (one private reply until they respond). */
  opener: { enabled: boolean; text: string; buttonLabel: string }
  /** `reminderText` is sent when they tap the button but still aren't following. */
  followGate: { enabled: boolean; text: string; buttonLabel: string; reminderText: string }
  collect: { kind: 'none' | 'email' | 'phone'; question: string; retryText: string }
  /** `imageUrl` is sent as its own picture message just before the text; '' means none. */
  message: { text: string; imageUrl: string; links: LinkButton[] }
  /** One reminder if they go quiet at a tap/answer step. Needs an open DM window, so never the first message after a comment. */
  nudge: { enabled: boolean; afterHours: number; text: string }
  tags: string[]
}

export const DEFAULT_RECIPE: Recipe = {
  trigger: {
    type: 'comment_keyword',
    posts: { mode: 'any' },
    keywords: ['LINK'],
    match: 'contains',
    publicReplies: { enabled: true, replies: ['Sent it to your DMs 📩', 'Check your DMs! ✨'] },
  },
  opener: { enabled: true, text: "Hey {{first_name|there}}! Tap below and I'll send it over 👇", buttonLabel: 'Send it to me' },
  followGate: {
    enabled: false,
    text: "Looks like you're not following yet 👀 Follow me, then tap the button below.",
    buttonLabel: 'I followed ✓',
    reminderText: "Hmm, I still don't see the follow 🤔 Follow me, then tap the button again.",
  },
  collect: {
    kind: 'none',
    question: "What's your email? I'll send a copy there too.",
    retryText: "Hmm, that doesn't look right. Mind trying again?",
  },
  message: { text: 'Here you go! 🎉', imageUrl: '', links: [{ label: 'Open link', url: 'https://example.com' }] },
  nudge: {
    enabled: false,
    afterHours: 4,
    text: "Just a quick reminder 👋 Tap the button above or reply here whenever you're ready and I'll send it over!",
  },
  tags: [],
}

export const MAX_NUDGE_HOURS = 23

export const COLLECT_DEFAULTS = {
  email: {
    question: "What's your email? I'll send a copy there too.",
    retryText: "Hmm, that doesn't look like an email. Mind trying again?",
  },
  phone: {
    question: "What's the best number to reach you on?",
    retryText: "That doesn't look like a phone number. Could you send it again?",
  },
} as const

/** Limits for the keyword and tag chip inputs (they match the flow schema). */
export const KEYWORD_LIMITS = { max: 20, maxLength: 100 } as const
export const TAG_LIMITS = { max: 10, maxLength: 50 } as const

/**
 * Adds comma-separated chips from typed or pasted text. Duplicates are skipped case-insensitively
 * (including within the pasted batch), long words are cut to `maxLength`, and chips past `max` are
 * counted in `dropped` so the UI can say so.
 */
export function addChips(
  current: string[],
  input: string,
  { max, maxLength }: { max: number; maxLength: number },
): { value: string[]; dropped: number } {
  const value = [...current]
  const seen = new Set(current.map((word) => word.toLowerCase()))
  let dropped = 0
  for (const raw of input.split(',')) {
    const word = raw.trim().slice(0, maxLength).trim()
    if (!word || seen.has(word.toLowerCase())) continue
    seen.add(word.toLowerCase())
    if (value.length >= max) dropped++
    else value.push(word)
  }
  return { value, dropped }
}

/** Turns the email/phone question on or off, keeping the automatic lead tag in step with it. */
export function setCollectKind(recipe: Recipe, kind: 'email' | 'phone'): void {
  const removeTag = (tag: string) => void (recipe.tags = recipe.tags.filter((existing) => existing !== tag))
  if (recipe.collect.kind === kind) {
    recipe.collect = { ...recipe.collect, kind: 'none' }
    removeTag(`${kind}-lead`)
    return
  }
  recipe.collect = { kind, ...COLLECT_DEFAULTS[kind] }
  removeTag(`${kind === 'email' ? 'phone' : 'email'}-lead`)
  if (!recipe.tags.includes(`${kind}-lead`)) recipe.tags.push(`${kind}-lead`)
}

export function openerRequired(trigger: RecipeTrigger): boolean {
  return trigger.type === 'comment_keyword'
}

/** Whether the recipe has a step where a reminder can be sent. */
export function nudgeApplies(recipe: Recipe): boolean {
  if (recipe.trigger.type === 'ice_breaker') return false
  const firstDmIsOpener = recipe.opener.enabled && !openerRequired(recipe.trigger)
  return firstDmIsOpener || recipe.followGate.enabled || recipe.collect.kind !== 'none'
}

export function compileRecipe(recipe: Recipe): FlowDefinition {
  const { trigger } = recipe

  if (trigger.type === 'ice_breaker') {
    const steps: Record<string, Step> = {}
    trigger.items.forEach((item, index) => {
      steps[`answer_${index}`] = { type: 'send_message', text: item.answer, ...withLinks(item.links) }
    })
    return {
      trigger: {
        type: 'ice_breaker',
        items: trigger.items.map((item, index) => ({ question: item.question, startStep: `answer_${index}` })),
      },
      start: 'answer_0',
      steps,
    }
  }

  const steps: Record<string, Step> = {}

  // Built back to front so each step knows its successor.
  let head: string | undefined
  if (recipe.tags.length > 0) {
    steps.tag = { type: 'tag', add: recipe.tags }
    head = 'tag'
  }

  const nudge = recipe.nudge.enabled
    ? { nudge: { afterMinutes: Math.round(recipe.nudge.afterHours * 60), text: recipe.nudge.text } }
    : {}
  steps.deliver = {
    type: 'send_message',
    text: recipe.message.text,
    ...(recipe.message.imageUrl ? { imageUrl: recipe.message.imageUrl } : {}),
    ...withLinks(recipe.message.links),
    ...(head ? { next: head } : {}),
  }
  head = 'deliver'

  if (recipe.collect.kind !== 'none') {
    const kind = recipe.collect.kind
    steps.ask = {
      type: 'ask',
      question: recipe.collect.question,
      saveTo: kind,
      validate: kind,
      retryText: recipe.collect.retryText,
      maxAttempts: 2,
      timeoutMinutes: 1440,
      ...nudge,
      answered: head,
      invalid: head,
    }
    // Skip the question for people we already know.
    steps.has_contact = { type: 'condition', has: kind, yes: head, no: 'ask' }
    head = 'has_contact'
  }

  if (recipe.followGate.enabled) {
    // First miss sends the request; every later miss sends the separate reminder.
    steps.check = { type: 'check_follow', following: head, notFollowing: 'ask_follow' }
    steps.ask_follow = {
      type: 'send_message',
      text: recipe.followGate.text,
      buttons: [{ type: 'reply', id: 'followed', label: recipe.followGate.buttonLabel, next: 'recheck' }],
      ...nudge,
    }
    steps.recheck = { type: 'check_follow', following: head, notFollowing: 'remind_follow' }
    steps.remind_follow = {
      type: 'send_message',
      text: recipe.followGate.reminderText,
      buttons: [{ type: 'reply', id: 'followed_again', label: recipe.followGate.buttonLabel, next: 'recheck' }],
      ...nudge,
    }
    head = 'check'
  }

  if (recipe.opener.enabled || openerRequired(trigger)) {
    steps.opener = {
      type: 'send_message',
      text: recipe.opener.text,
      buttons: [{ type: 'reply', id: 'go', label: recipe.opener.buttonLabel, next: head }],
      // After a comment the opener is a one-shot private reply: Meta won't let us follow it up.
      ...(openerRequired(trigger) ? {} : nudge),
    }
    head = 'opener'
  }

  return { trigger: compileTrigger(trigger), start: head, steps }
}

function withLinks(links: LinkButton[]): { buttons?: Button[] } {
  return links.length > 0 ? { buttons: links.map((link) => ({ type: 'url', label: link.label, url: link.url })) } : {}
}

function linksOf(step: StepOf<'send_message'> | undefined): LinkButton[] {
  return (step?.buttons ?? []).flatMap((button) => (button.type === 'url' ? [{ label: button.label, url: button.url }] : []))
}

function compileTrigger(trigger: Exclude<RecipeTrigger, { type: 'ice_breaker' }>): Trigger {
  switch (trigger.type) {
    case 'comment_keyword': {
      const replies = trigger.publicReplies.replies.filter((reply) => reply.trim() !== '')
      return {
        type: 'comment_keyword',
        posts: trigger.posts,
        keywords: trigger.keywords,
        match: trigger.match,
        ...(trigger.publicReplies.enabled && replies.length > 0 ? { publicReplies: replies } : {}),
      }
    }
    case 'dm_keyword':
      return { type: 'dm_keyword', keywords: trigger.keywords, match: trigger.match }
    case 'story_reply':
      return {
        type: 'story_reply',
        includeReactions: trigger.includeReactions,
        ...(trigger.keywords.length > 0 ? { keywords: trigger.keywords } : {}),
      }
    case 'any_dm':
      return { type: 'any_dm' }
  }
}

/** Best-effort inverse of compileRecipe; also understands the shapes used by the built-in templates. */
export function recipeFromFlow(flow: FlowDefinition): Recipe {
  const recipe: Recipe = structuredClone(DEFAULT_RECIPE)
  recipe.opener.enabled = false
  recipe.message.links = []

  const { trigger } = flow
  if (trigger.type === 'ice_breaker') {
    recipe.trigger = {
      type: 'ice_breaker',
      items: trigger.items.map((item) => {
        const step = flow.steps[item.startStep]
        return {
          question: item.question,
          answer: step?.type === 'send_message' ? step.text : '',
          links: step?.type === 'send_message' ? linksOf(step) : [],
        }
      }),
    }
    return recipe
  }

  recipe.trigger = triggerToRecipe(trigger)

  const seen = new Set<string>()
  let id: string | undefined = flow.start
  let messageFound = false
  while (id && !seen.has(id)) {
    seen.add(id)
    const step: Step | undefined = flow.steps[id]
    if (!step) break
    switch (step.type) {
      case 'send_message': {
        const reply = replyButton(step)
        if (reply && !messageFound && !recipe.opener.enabled && !recipe.followGate.enabled) {
          recipe.opener = { enabled: true, text: step.text, buttonLabel: reply.label }
          readNudge(recipe, step)
          id = reply.next
        } else {
          messageFound = true
          recipe.message.text = step.text
          recipe.message.imageUrl = step.imageUrl ?? ''
          recipe.message.links = linksOf(step)
          id = step.next
        }
        break
      }
      case 'check_follow': {
        const gate = step.notFollowing ? flow.steps[step.notFollowing] : undefined
        if (gate?.type === 'send_message') {
          const button = replyButton(gate)
          const recheck = button?.next && button.next !== id ? flow.steps[button.next] : undefined
          const reminder = recheck?.type === 'check_follow' && recheck.notFollowing ? flow.steps[recheck.notFollowing] : undefined
          recipe.followGate = {
            enabled: true,
            text: gate.text,
            buttonLabel: button?.label ?? 'I followed ✓',
            // Older flows loop straight back to the first check, so they get the default reminder.
            reminderText: reminder?.type === 'send_message' ? reminder.text : DEFAULT_RECIPE.followGate.reminderText,
          }
          readNudge(recipe, gate)
        } else {
          recipe.followGate.enabled = true
        }
        id = step.following
        break
      }
      case 'condition':
        id = typeof step.has === 'string' ? step.no : step.yes
        break
      case 'ask':
        if (step.saveTo === 'email' || step.saveTo === 'phone') {
          recipe.collect = { kind: step.saveTo, question: step.question, retryText: step.retryText }
          readNudge(recipe, step)
        }
        id = step.answered
        break
      case 'tag':
        recipe.tags = step.add ?? []
        id = step.next
        break
      case 'delay':
        id = step.next
        break
    }
  }
  // Don't leave the default "Here you go!" in place of a message the flow doesn't have.
  if (!messageFound) recipe.message.text = ''
  return recipe
}

function readNudge(recipe: Recipe, step: StepOf<'send_message'> | StepOf<'ask'>): void {
  if (!step.nudge || recipe.nudge.enabled) return
  recipe.nudge = {
    enabled: true,
    afterHours: Math.min(MAX_NUDGE_HOURS, Math.max(1, Math.round(step.nudge.afterMinutes / 60))),
    text: step.nudge.text,
  }
}

function replyButton(step: StepOf<'send_message'>) {
  return (step.buttons ?? []).find((button) => button.type === 'reply')
}

function triggerToRecipe(trigger: Exclude<Trigger, { type: 'ice_breaker' }>): RecipeTrigger {
  switch (trigger.type) {
    case 'comment_keyword':
      return {
        type: 'comment_keyword',
        posts: trigger.posts,
        keywords: trigger.keywords,
        match: trigger.match,
        publicReplies: {
          enabled: (trigger.publicReplies ?? []).length > 0,
          replies: trigger.publicReplies?.length ? trigger.publicReplies : ['Sent it to your DMs 📩'],
        },
      }
    case 'dm_keyword':
      return { type: 'dm_keyword', keywords: trigger.keywords, match: trigger.match }
    case 'story_reply':
      return { type: 'story_reply', includeReactions: trigger.includeReactions, keywords: trigger.keywords ?? [] }
    case 'any_dm':
      return { type: 'any_dm' }
  }
}

/** Switching trigger type keeps keywords where it makes sense. */
export function changeTriggerType(current: RecipeTrigger, type: RecipeTrigger['type']): RecipeTrigger {
  const keywords = 'keywords' in current && current.keywords.length > 0 ? current.keywords : ['LINK']
  switch (type) {
    case 'comment_keyword':
      return {
        type,
        posts: { mode: 'any' },
        keywords,
        match: 'contains',
        publicReplies: { enabled: true, replies: ['Sent it to your DMs 📩', 'Check your DMs! ✨'] },
      }
    case 'dm_keyword':
      return { type, keywords, match: 'contains' }
    case 'story_reply':
      return { type, includeReactions: true, keywords: [] }
    case 'any_dm':
      return { type }
    case 'ice_breaker':
      return { type, items: [{ question: 'What do you offer?', answer: "Here's what we offer: …", links: [] }] }
  }
}
