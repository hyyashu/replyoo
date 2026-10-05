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
  | { type: 'ice_breaker'; items: { question: string; answer: string }[] }

type TriggerOfType<T extends Trigger['type']> = Extract<Trigger, { type: T }>

export interface Recipe {
  trigger: RecipeTrigger
  /** Message with a reply button sent first. Required for comment triggers (one private reply until they respond). */
  opener: { enabled: boolean; text: string; buttonLabel: string }
  followGate: { enabled: boolean; text: string; buttonLabel: string }
  collect: { kind: 'none' | 'email' | 'phone'; question: string; retryText: string }
  message: { text: string; link: { enabled: boolean; label: string; url: string } }
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
  },
  collect: {
    kind: 'none',
    question: "What's your email? I'll send a copy there too.",
    retryText: "Hmm, that doesn't look right. Mind trying again?",
  },
  message: { text: 'Here you go! 🎉', link: { enabled: true, label: 'Open link', url: 'https://example.com' } },
  tags: [],
}

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

export function openerRequired(trigger: RecipeTrigger): boolean {
  return trigger.type === 'comment_keyword'
}

export function compileRecipe(recipe: Recipe): FlowDefinition {
  const { trigger } = recipe

  if (trigger.type === 'ice_breaker') {
    const steps: Record<string, Step> = {}
    trigger.items.forEach((item, index) => {
      steps[`answer_${index}`] = { type: 'send_message', text: item.answer }
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

  const buttons: Button[] = recipe.message.link.enabled
    ? [{ type: 'url', label: recipe.message.link.label, url: recipe.message.link.url }]
    : []
  steps.deliver = {
    type: 'send_message',
    text: recipe.message.text,
    ...(buttons.length > 0 ? { buttons } : {}),
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
      answered: head,
      invalid: head,
    }
    // Skip the question for people we already know.
    steps.has_contact = { type: 'condition', has: kind, yes: head, no: 'ask' }
    head = 'has_contact'
  }

  if (recipe.followGate.enabled) {
    steps.check = { type: 'check_follow', following: head, notFollowing: 'ask_follow' }
    steps.ask_follow = {
      type: 'send_message',
      text: recipe.followGate.text,
      buttons: [{ type: 'reply', id: 'followed', label: recipe.followGate.buttonLabel, next: 'check' }],
    }
    head = 'check'
  }

  if (recipe.opener.enabled || openerRequired(trigger)) {
    steps.opener = {
      type: 'send_message',
      text: recipe.opener.text,
      buttons: [{ type: 'reply', id: 'go', label: recipe.opener.buttonLabel, next: head }],
    }
    head = 'opener'
  }

  return { trigger: compileTrigger(trigger), start: head, steps }
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
  recipe.message.link.enabled = false

  const { trigger } = flow
  if (trigger.type === 'ice_breaker') {
    recipe.trigger = {
      type: 'ice_breaker',
      items: trigger.items.map((item) => {
        const step = flow.steps[item.startStep]
        return { question: item.question, answer: step?.type === 'send_message' ? step.text : '' }
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
          id = reply.next
        } else {
          messageFound = true
          recipe.message.text = step.text
          const link = (step.buttons ?? []).find((button) => button.type === 'url')
          recipe.message.link = link
            ? { enabled: true, label: link.label, url: link.url }
            : { ...recipe.message.link, enabled: false }
          id = step.next
        }
        break
      }
      case 'check_follow': {
        const gate = step.notFollowing ? flow.steps[step.notFollowing] : undefined
        if (gate?.type === 'send_message') {
          recipe.followGate = { enabled: true, text: gate.text, buttonLabel: replyButton(gate)?.label ?? 'I followed ✓' }
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
  return recipe
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
      return { type, items: [{ question: 'What do you offer?', answer: "Here's what we offer: …" }] }
  }
}
