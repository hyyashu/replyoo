import type {
  ContactState,
  EngineEvent,
  FlowRunState,
  StartTrigger,
  TriggerCandidate,
} from '@replyooo/engine'
import { advance, matchAutomation } from '@replyooo/engine'
import type { NormalizedEvent } from '@replyooo/meta'
import type { FlowDefinition } from '@replyooo/shared'
import { decodePostback } from '@replyooo/shared'

export interface WaitingRun {
  id: string
  run: FlowRunState
  flow: FlowDefinition
}

export interface RouteInput {
  event: NormalizedEvent
  contact: ContactState
  waitingRun: WaitingRun | null
  candidates: readonly TriggerCandidate[]
  mediaPublishedAt: Date | null
  now: Date
}

export type Route =
  | { kind: 'resume'; runId: string; event: EngineEvent }
  | { kind: 'start'; automationId: string; trigger: StartTrigger }
  | { kind: 'ignore'; reason: string }

const ignore = (reason: string): Route => ({ kind: 'ignore', reason })

export function decideRoute(input: RouteInput): Route {
  const { event } = input
  switch (event.type) {
    case 'postback':
      return routePostback(input, event.payload)
    case 'comment_created': {
      const match = matchAutomation(
        { kind: 'comment', text: event.text, mediaId: event.mediaId, mediaPublishedAt: input.mediaPublishedAt },
        input.candidates,
      )
      if (!match) return ignore('no_matching_automation')
      return {
        kind: 'start',
        automationId: match.automationId,
        trigger: { kind: 'comment', commentId: event.commentId, text: event.text },
      }
    }
    case 'dm_received':
    case 'story_reply': {
      const { text } = event
      const { waitingRun } = input
      if (waitingRun && text !== null && acceptsReply(input, waitingRun, text)) {
        return { kind: 'resume', runId: waitingRun.id, event: { type: 'reply', text } }
      }
      const match =
        event.type === 'dm_received'
          ? matchAutomation({ kind: 'dm', text: text ?? '' }, input.candidates)
          : matchAutomation({ kind: 'story', text, isReaction: event.isReaction }, input.candidates)
      if (!match) return ignore('no_matching_automation')
      if (waitingRun && match.trigger.type === 'any_dm') return ignore('waiting_run_has_priority')
      const trigger: StartTrigger =
        event.type === 'dm_received' ? { kind: 'dm', text: text ?? '' } : { kind: 'story', text }
      return { kind: 'start', automationId: match.automationId, trigger }
    }
  }
}

function acceptsReply(input: RouteInput, waitingRun: WaitingRun, text: string): boolean {
  const result = advance({
    run: waitingRun.run,
    flow: waitingRun.flow,
    contact: input.contact,
    event: { type: 'reply', text },
    now: input.now,
  })
  return !result.ignored
}

function routePostback(input: RouteInput, payload: string): Route {
  const decoded = decodePostback(payload)
  if (!decoded) return ignore('unknown_postback')
  if (decoded.kind === 'run') {
    return {
      kind: 'resume',
      runId: decoded.runId,
      event: { type: 'postback', stepId: decoded.stepId, buttonId: decoded.buttonId },
    }
  }
  const candidate = input.candidates.find((c) => c.automationId === decoded.automationId)
  if (candidate?.trigger.type !== 'ice_breaker' || !candidate.trigger.items[decoded.itemIndex]) {
    return ignore('unknown_ice_breaker')
  }
  return {
    kind: 'start',
    automationId: candidate.automationId,
    trigger: { kind: 'ice_breaker', itemIndex: decoded.itemIndex },
  }
}
