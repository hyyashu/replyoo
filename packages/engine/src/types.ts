import type { FlowDefinition } from '@replyooo/shared'

export { MAX_STEPS_PER_ADVANCE } from '@replyooo/shared'
export const POSTBACK_WAIT_MINUTES = 24 * 60
export const FOLLOW_CHECK_WAIT_MINUTES = 5

export type RunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'expired' | 'cancelled'

/** How the next outbound message may be delivered. */
export type OutboundMode = 'dm' | 'private_reply' | 'blocked'

/**
 * `nudgeDeadline` is set while a reminder is still pending: the run wakes at the reminder
 * time (`waitUntil`), sends it once, then keeps waiting until this ISO deadline.
 */
export type Wait =
  | { kind: 'postback'; nudgeDeadline?: string }
  | { kind: 'reply'; attempts: number; nudgeDeadline?: string }
  | { kind: 'delay' }
  | { kind: 'follow_check' }

export interface FlowRunState {
  status: RunStatus
  currentStepId: string | null
  wait: Wait | null
  waitUntil: Date | null
  vars: Record<string, string>
  stateVersion: number
  outbound: OutboundMode
  commentId: string | null
  error: string | null
}

export interface ContactState {
  username: string | null
  name: string | null
  email: string | null
  phone: string | null
  tags: string[]
  fields: Record<string, string>
}

export type StartTrigger =
  | { kind: 'comment'; commentId: string; text: string }
  | { kind: 'dm'; text: string }
  | { kind: 'story'; text: string | null }
  | { kind: 'ice_breaker'; itemIndex: number }

export type EngineEvent =
  | { type: 'start'; trigger: StartTrigger }
  | { type: 'postback'; stepId: string; buttonId: string }
  | { type: 'reply'; text: string }
  | { type: 'timeout' }
  | { type: 'follow_result'; following: boolean }

export type OutboundButton =
  | { type: 'url'; label: string; url: string }
  | { type: 'reply'; label: string; stepId: string; buttonId: string }

export interface OutboundMessage {
  text: string
  imageUrl?: string
  buttons?: OutboundButton[]
}

export interface ContactPatch {
  email?: string
  phone?: string
  fields?: Record<string, string>
  addTags?: string[]
  removeTags?: string[]
}

export type Effect =
  | { type: 'send'; message: OutboundMessage }
  | { type: 'private_reply'; commentId: string; message: OutboundMessage }
  | { type: 'comment_reply'; commentId: string; text: string }
  | { type: 'check_follow' }
  | { type: 'schedule_timeout'; at: Date }
  | { type: 'update_contact'; patch: ContactPatch }

export interface AdvanceInput {
  run: FlowRunState
  flow: FlowDefinition
  contact: ContactState
  event: EngineEvent
  now: Date
  /** Returns a number in [0, 1). Defaults to Math.random. */
  random?: () => number
}

export interface AdvanceResult {
  run: FlowRunState
  effects: Effect[]
  /** True when the event did not apply to this run; `run` is then the input run unchanged. */
  ignored: boolean
}
