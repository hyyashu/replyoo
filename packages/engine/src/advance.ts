import type { FlowDefinition, Step, StepOf, StepType } from '@replyooo/shared'
import { hasReplyButtons, normalizeText } from '@replyooo/shared'
import { parseAnswer } from './answers'
import { renderText } from './render'
import type {
  AdvanceInput,
  AdvanceResult,
  ContactPatch,
  ContactState,
  Effect,
  EngineEvent,
  FlowRunState,
  OutboundMessage,
  StartTrigger,
  Wait,
} from './types'
import { MAX_STEPS_PER_ADVANCE, POSTBACK_WAIT_MINUTES } from './types'

interface Ctx {
  flow: FlowDefinition
  now: Date
  random: () => number
  run: FlowRunState
  contact: ContactState
  effects: Effect[]
}

type StepOutcome = { next: string | undefined } | 'stop'

export function newRunState(): FlowRunState {
  return {
    status: 'running',
    currentStepId: null,
    wait: null,
    waitUntil: null,
    vars: {},
    stateVersion: 0,
    outbound: 'dm',
    commentId: null,
    error: null,
  }
}

export function advance(input: AdvanceInput): AdvanceResult {
  const ctx: Ctx = {
    flow: input.flow,
    now: input.now,
    random: input.random ?? Math.random,
    run: structuredClone(input.run),
    contact: structuredClone(input.contact),
    effects: [],
  }
  if (!dispatch(ctx, input.event)) return { run: input.run, effects: [], ignored: true }
  ctx.run.stateVersion = input.run.stateVersion + 1
  return { run: ctx.run, effects: ctx.effects, ignored: false }
}

function dispatch(ctx: Ctx, event: EngineEvent): boolean {
  if (event.type === 'start') {
    start(ctx, event.trigger)
    return true
  }
  if (ctx.run.status !== 'waiting' || !ctx.run.wait) return false
  switch (event.type) {
    case 'postback':
      return onPostback(ctx, event.stepId, event.buttonId)
    case 'reply':
      return onReply(ctx, event.text)
    case 'timeout':
      return onTimeout(ctx)
    case 'follow_result':
      return onFollowResult(ctx, event.following)
  }
}

// ---------- start ----------

function start(ctx: Ctx, trigger: StartTrigger): void {
  const { flow } = ctx
  ctx.run = newRunState()
  let entry = flow.start

  if (trigger.kind === 'comment') {
    ctx.run.outbound = 'private_reply'
    ctx.run.commentId = trigger.commentId
    const replies = flow.trigger.type === 'comment_keyword' ? (flow.trigger.publicReplies ?? []) : []
    const index = Math.min(replies.length - 1, Math.floor(ctx.random() * replies.length))
    const reply = replies[index]
    if (reply) {
      ctx.effects.push({
        type: 'comment_reply',
        commentId: trigger.commentId,
        text: renderText(reply, ctx.contact, ctx.run.vars),
      })
    }
  }

  if (trigger.kind === 'ice_breaker') {
    if (flow.trigger.type !== 'ice_breaker') return fail(ctx, 'trigger_mismatch')
    const item = flow.trigger.items[trigger.itemIndex]
    if (!item) return fail(ctx, 'unknown_ice_breaker')
    entry = item.startStep
  }

  runFrom(ctx, entry)
}

// ---------- resume handlers (filled in by later tasks) ----------

function onPostback(ctx: Ctx, stepId: string, buttonId: string): boolean {
  if (ctx.run.wait?.kind !== 'postback' || ctx.run.currentStepId !== stepId) return false
  const step = currentStep(ctx, 'send_message')
  const button = step?.buttons?.find((b) => b.type === 'reply' && b.id === buttonId)
  if (!button || button.type !== 'reply') return false
  ctx.run.outbound = 'dm'
  runFrom(ctx, button.next)
  return true
}

function onReply(ctx: Ctx, text: string): boolean {
  const current = ctx.run.wait
  if (current?.kind === 'postback') {
    const step = currentStep(ctx, 'send_message')
    const typed = normalizeText(text)
    const button = step?.buttons?.find((b) => b.type === 'reply' && normalizeText(b.label) === typed)
    if (!button || button.type !== 'reply' || !ctx.run.currentStepId) return false
    return onPostback(ctx, ctx.run.currentStepId, button.id)
  }
  if (current?.kind !== 'reply') return false
  const step = currentStep(ctx, 'ask')
  if (!step) return false

  ctx.run.outbound = 'dm'
  const value = parseAnswer(text, step.validate)
  if (value !== null) {
    saveAnswer(ctx, step, value)
    runFrom(ctx, step.answered)
    return true
  }

  const attempts = current.attempts + 1
  if (attempts >= step.maxAttempts) {
    runFrom(ctx, step.invalid)
    return true
  }
  ctx.run.wait = { kind: 'reply', attempts }
  ctx.effects.push({
    type: 'send',
    message: { text: renderText(step.retryText, ctx.contact, ctx.run.vars) },
  })
  return true
}

function onTimeout(ctx: Ctx): boolean {
  const { wait: current, waitUntil } = ctx.run
  if (!current || !waitUntil || ctx.now.getTime() < waitUntil.getTime()) return false
  switch (current.kind) {
    case 'postback':
      ctx.run.status = 'expired'
      ctx.run.wait = null
      ctx.run.waitUntil = null
      return true
    case 'reply': {
      const step = currentStep(ctx, 'ask')
      if (!step) return false
      runFrom(ctx, step.timeout)
      return true
    }
    case 'delay':
    case 'follow_check':
      return false
  }
}

function onFollowResult(_ctx: Ctx, _following: boolean): boolean {
  return false
}

// ---------- execution ----------

function runFrom(ctx: Ctx, stepId: string | undefined): void {
  ctx.run.status = 'running'
  ctx.run.wait = null
  ctx.run.waitUntil = null
  let id = stepId
  let budget = MAX_STEPS_PER_ADVANCE
  while (id !== undefined) {
    if (budget-- <= 0) return fail(ctx, 'step_budget_exceeded')
    const step = ctx.flow.steps[id]
    if (!step) return fail(ctx, `missing_step:${id}`)
    ctx.run.currentStepId = id
    const outcome = execute(ctx, id, step)
    if (outcome === 'stop') return
    id = outcome.next
  }
  complete(ctx)
}

function execute(ctx: Ctx, stepId: string, step: Step): StepOutcome {
  switch (step.type) {
    case 'send_message': {
      if (!send(ctx, buildMessage(ctx, stepId, step))) return 'stop'
      if (hasReplyButtons(step)) {
        wait(ctx, { kind: 'postback' }, POSTBACK_WAIT_MINUTES)
        return 'stop'
      }
      return { next: step.next }
    }
    case 'ask': {
      if (!send(ctx, { text: renderText(step.question, ctx.contact, ctx.run.vars) })) return 'stop'
      wait(ctx, { kind: 'reply', attempts: 0 }, step.timeoutMinutes)
      return 'stop'
    }
    case 'check_follow':
      return 'stop'
    case 'delay':
      return 'stop'
    case 'tag': {
      const add = step.add ?? []
      const remove = step.remove ?? []
      if (add.length > 0 || remove.length > 0) {
        ctx.contact.tags = [...new Set([...ctx.contact.tags.filter((t) => !remove.includes(t)), ...add])]
        ctx.effects.push({
          type: 'update_contact',
          patch: {
            ...(add.length > 0 ? { addTags: add } : {}),
            ...(remove.length > 0 ? { removeTags: remove } : {}),
          },
        })
      }
      return { next: step.next }
    }
    case 'condition':
      return { next: evaluate(ctx.contact, step.has) ? step.yes : step.no }
  }
}

// ---------- helpers ----------

function buildMessage(ctx: Ctx, stepId: string, step: StepOf<'send_message'>): OutboundMessage {
  const message: OutboundMessage = { text: renderText(step.text, ctx.contact, ctx.run.vars) }
  if (step.imageUrl) message.imageUrl = step.imageUrl
  if (step.buttons && step.buttons.length > 0) {
    message.buttons = step.buttons.map((button) =>
      button.type === 'url'
        ? { type: 'url', label: button.label, url: button.url }
        : { type: 'reply', label: button.label, stepId, buttonId: button.id },
    )
  }
  return message
}

/** Emits the message using the allowed channel. Returns false (and fails the run) if none is open. */
function send(ctx: Ctx, message: OutboundMessage): boolean {
  switch (ctx.run.outbound) {
    case 'dm':
      ctx.effects.push({ type: 'send', message })
      return true
    case 'private_reply': {
      const commentId = ctx.run.commentId
      if (!commentId) {
        fail(ctx, 'missing_comment_id')
        return false
      }
      ctx.effects.push({ type: 'private_reply', commentId, message })
      ctx.run.outbound = 'blocked'
      return true
    }
    case 'blocked':
      fail(ctx, 'messaging_window_closed')
      return false
  }
}

function wait(ctx: Ctx, kind: Wait, minutes: number): void {
  const at = new Date(ctx.now.getTime() + minutes * 60_000)
  ctx.run.status = 'waiting'
  ctx.run.wait = kind
  ctx.run.waitUntil = at
  ctx.effects.push({ type: 'schedule_timeout', at })
}

function currentStep<T extends StepType>(ctx: Ctx, type: T): StepOf<T> | null {
  const id = ctx.run.currentStepId
  if (!id) return null
  const step = ctx.flow.steps[id]
  return step && step.type === type ? (step as StepOf<T>) : null
}

function evaluate(contact: ContactState, has: StepOf<'condition'>['has']): boolean {
  if (has === 'email') return Boolean(contact.email)
  if (has === 'phone') return Boolean(contact.phone)
  if ('tag' in has) return contact.tags.includes(has.tag)
  return Boolean(contact.fields[has.field])
}

function fail(ctx: Ctx, error: string): void {
  ctx.run.status = 'failed'
  ctx.run.error = error
  ctx.run.wait = null
  ctx.run.waitUntil = null
}

function complete(ctx: Ctx): void {
  ctx.run.status = 'completed'
  ctx.run.wait = null
  ctx.run.waitUntil = null
  ctx.run.currentStepId = null
}

function saveAnswer(ctx: Ctx, step: StepOf<'ask'>, value: string): void {
  const patch: ContactPatch = {}
  let key: string
  if (step.saveTo === 'email') {
    key = 'email'
    ctx.contact.email = value
    patch.email = value
  } else if (step.saveTo === 'phone') {
    key = 'phone'
    ctx.contact.phone = value
    patch.phone = value
  } else {
    key = step.saveTo.field
    ctx.contact.fields = { ...ctx.contact.fields, [key]: value }
    patch.fields = { [key]: value }
  }
  ctx.run.vars = { ...ctx.run.vars, [key]: value }
  ctx.effects.push({ type: 'update_contact', patch })
}
