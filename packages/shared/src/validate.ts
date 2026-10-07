import type { FlowDefinition, Step, StepOf } from './flow'
import type { Platform } from './platform'

export type ValidationCode =
  | 'missing_start'
  | 'missing_target'
  | 'orphan_step'
  | 'comment_needs_reply_button'
  | 'platform_unsupported'
  | 'no_posts_selected'
  | 'cycle_without_wait'
  | 'next_with_reply_buttons'
  | 'save_type_mismatch'
  | 'buttons_text_too_long'
  | 'comment_first_message_image'
  | 'nudge_without_wait'
  | 'nudge_after_private_reply'
  | 'nudge_too_late'

export interface ValidationIssue {
  code: ValidationCode
  message: string
  stepId?: string
}

/** Meta's button template caps the text above the buttons at 640 characters. */
export const MAX_BUTTON_TEMPLATE_TEXT = 640

const isDefined = <T>(value: T | undefined): value is T => value !== undefined

export function hasReplyButtons(step: StepOf<'send_message'>): boolean {
  return (step.buttons ?? []).some((button) => button.type === 'reply')
}

export function isWaitStep(step: Step): boolean {
  if (step.type === 'ask' || step.type === 'delay' || step.type === 'check_follow') return true
  return step.type === 'send_message' && hasReplyButtons(step)
}

export function stepTargets(step: Step): string[] {
  switch (step.type) {
    case 'send_message':
      return [
        step.next,
        ...(step.buttons ?? []).map((button) => (button.type === 'reply' ? button.next : undefined)),
      ].filter(isDefined)
    case 'ask':
      return [step.answered, step.invalid, step.timeout].filter(isDefined)
    case 'check_follow':
      return [step.following, step.notFollowing].filter(isDefined)
    case 'delay':
    case 'tag':
      return [step.next].filter(isDefined)
    case 'condition':
      return [step.yes, step.no].filter(isDefined)
  }
}

export function entryStepIds(flow: FlowDefinition): string[] {
  if (flow.trigger.type !== 'ice_breaker') return [flow.start]
  return [...new Set([flow.start, ...flow.trigger.items.map((item) => item.startStep)])]
}

export function validateFlow(flow: FlowDefinition, platform: Platform): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const { steps, trigger } = flow
  const entries = entryStepIds(flow)

  for (const entry of entries) {
    if (!steps[entry]) {
      issues.push({ code: 'missing_start', message: `Start step "${entry}" does not exist` })
    }
  }

  for (const [stepId, step] of Object.entries(steps)) {
    for (const target of stepTargets(step)) {
      if (!steps[target]) {
        issues.push({ code: 'missing_target', stepId, message: `Step "${target}" does not exist` })
      }
    }
    if (step.type === 'send_message' && hasReplyButtons(step) && step.next) {
      issues.push({
        code: 'next_with_reply_buttons',
        stepId,
        message: 'A message with reply buttons continues from its buttons, not from "next"',
      })
    }
    if (
      step.type === 'send_message' &&
      (step.buttons ?? []).length > 0 &&
      step.text.length > MAX_BUTTON_TEMPLATE_TEXT
    ) {
      issues.push({
        code: 'buttons_text_too_long',
        stepId,
        message: `Messages with buttons can be at most ${MAX_BUTTON_TEMPLATE_TEXT} characters`,
      })
    }
    if ((step.type === 'send_message' || step.type === 'ask') && step.nudge) {
      if (step.type === 'send_message' && !hasReplyButtons(step)) {
        issues.push({ code: 'nudge_without_wait', stepId, message: 'A reminder needs a reply button to wait on' })
      }
      if (step.type === 'ask' && step.nudge.afterMinutes >= step.timeoutMinutes) {
        issues.push({
          code: 'nudge_too_late',
          stepId,
          message: 'The reminder must come before the question times out',
        })
      }
      if (trigger.type === 'comment_keyword' && stepId === flow.start) {
        issues.push({
          code: 'nudge_after_private_reply',
          stepId,
          message: 'Meta allows only one message after a comment until the person replies, so this step cannot send a reminder',
        })
      }
    }
    if (
      step.type === 'ask' &&
      ((step.saveTo === 'email' && step.validate !== 'email') ||
        (step.saveTo === 'phone' && step.validate !== 'phone'))
    ) {
      issues.push({
        code: 'save_type_mismatch',
        stepId,
        message: 'Answers saved to email/phone must use matching validation',
      })
    }
    if (step.type === 'check_follow' && platform === 'facebook') {
      issues.push({
        code: 'platform_unsupported',
        stepId,
        message: 'Follow checks are only available on Instagram',
      })
    }
  }

  if (trigger.type === 'story_reply' && platform === 'facebook') {
    issues.push({ code: 'platform_unsupported', message: 'Story replies are only available on Instagram' })
  }

  if (trigger.type === 'comment_keyword') {
    if (trigger.posts.mode === 'specific' && trigger.posts.mediaIds.length === 0) {
      issues.push({ code: 'no_posts_selected', message: 'Pick at least one post' })
    }
    const first = steps[flow.start]
    if (!first || first.type !== 'send_message' || !hasReplyButtons(first)) {
      issues.push({
        code: 'comment_needs_reply_button',
        stepId: flow.start,
        message:
          'Comment automations must start with a message that has a reply button — Meta allows only one message until the person replies',
      })
    }
    if (first?.type === 'send_message' && first.imageUrl) {
      issues.push({
        code: 'comment_first_message_image',
        stepId: flow.start,
        message: 'The first message after a comment is a single private reply and cannot include an image',
      })
    }
  }

  issues.push(...findOrphans(flow, entries), ...findCyclesWithoutWait(flow))
  return issues
}

function findOrphans(flow: FlowDefinition, entries: string[]): ValidationIssue[] {
  const reached = new Set<string>()
  const queue = entries.filter((entry) => flow.steps[entry])
  while (queue.length > 0) {
    const id = queue.pop() as string
    if (reached.has(id)) continue
    reached.add(id)
    const step = flow.steps[id]
    if (step) queue.push(...stepTargets(step).filter((target) => flow.steps[target]))
  }
  return Object.keys(flow.steps)
    .filter((id) => !reached.has(id))
    .map((stepId) => ({ code: 'orphan_step' as const, stepId, message: 'This step can never be reached' }))
}

function findCyclesWithoutWait(flow: FlowDefinition): ValidationIssue[] {
  const state = new Map<string, 'visiting' | 'done'>()
  const flagged = new Set<string>()

  const visit = (id: string) => {
    state.set(id, 'visiting')
    const step = flow.steps[id]
    for (const target of step ? stepTargets(step) : []) {
      const targetStep = flow.steps[target]
      if (!targetStep || isWaitStep(targetStep)) continue
      const targetState = state.get(target)
      if (targetState === 'visiting') flagged.add(target)
      else if (targetState === undefined) visit(target)
    }
    state.set(id, 'done')
  }

  for (const [id, step] of Object.entries(flow.steps)) {
    if (!isWaitStep(step) && !state.has(id)) visit(id)
  }

  return [...flagged].map((stepId) => ({
    code: 'cycle_without_wait' as const,
    stepId,
    message: 'This loop never waits for the person, so it would repeat forever',
  }))
}
