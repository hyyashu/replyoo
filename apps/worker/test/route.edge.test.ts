// Pure unit tests for decideRoute: no database or queue needed.
import type { ContactState, FlowRunState, TriggerCandidate } from '@replyooo/engine'
import { newRunState } from '@replyooo/engine'
import type { NormalizedEvent } from '@replyooo/meta'
import type { FlowDefinition, Trigger } from '@replyooo/shared'
import { describe, expect, it } from 'vitest'
import type { RouteInput, WaitingRun } from '../src/route'
import { decideRoute } from '../src/route'

const NOW = new Date('2026-10-06T10:00:00Z')
const contact: ContactState = { username: null, name: null, email: null, phone: null, tags: [], fields: {} }
const base = { platform: 'instagram' as const, accountExternalId: 'acct', senderId: 'u1', occurredAt: NOW.toISOString() }

const dm = (text: string | null): NormalizedEvent => ({ ...base, type: 'dm_received', dedupKey: 'd', messageId: 'm', text })
const story = (text: string | null, isReaction: boolean): NormalizedEvent => ({
  ...base,
  type: 'story_reply',
  dedupKey: 'd',
  messageId: 'm',
  storyId: null,
  text,
  isReaction,
})
const postback = (payload: string): NormalizedEvent => ({ ...base, type: 'postback', dedupKey: 'd', messageId: 'm', payload, title: null })
const comment = (text: string): NormalizedEvent => ({
  ...base,
  type: 'comment_created',
  dedupKey: 'd',
  commentId: 'c1',
  mediaId: 'media1',
  text,
  senderUsername: 'priya',
  senderName: null,
})

const candidate = (automationId: string, trigger: Trigger, publishedAt = NOW): TriggerCandidate => ({
  automationId,
  publishedAt,
  trigger,
})
const anyDm = candidate('any', { type: 'any_dm' })
const priceKeyword = candidate('price', { type: 'dm_keyword', keywords: ['price'], match: 'contains' })
const guideComment = candidate('guide', { type: 'comment_keyword', posts: { mode: 'any' }, keywords: ['guide'], match: 'contains' })
const storyAll = candidate('story', { type: 'story_reply', includeReactions: true })
const iceBreaker = candidate('ib', { type: 'ice_breaker', items: [{ question: 'Pricing?', startStep: 's1' }] })

const waiting = (flow: FlowDefinition, state: Partial<FlowRunState>): WaitingRun => ({
  id: 'run1',
  flow,
  run: { ...newRunState(), status: 'waiting', stateVersion: 1, ...state },
})

const askText = waiting(
  {
    trigger: { type: 'any_dm' },
    start: 'ask',
    steps: {
      ask: {
        type: 'ask',
        question: 'What should we call you?',
        saveTo: { field: 'nickname' },
        validate: 'text',
        retryText: 'Again',
        maxAttempts: 2,
        timeoutMinutes: 60,
      },
    },
  },
  { currentStepId: 'ask', wait: { kind: 'reply', attempts: 0 }, waitUntil: new Date(NOW.getTime() + 3_600_000) },
)

const buttonWait = waiting(
  {
    trigger: { type: 'any_dm' },
    start: 's1',
    steps: {
      s1: { type: 'send_message', text: 'Want it?', buttons: [{ type: 'reply', id: 'yes', label: 'Send it', next: 's2' }] },
      s2: { type: 'send_message', text: 'Here' },
    },
  },
  { currentStepId: 's1', wait: { kind: 'postback' }, waitUntil: new Date(NOW.getTime() + 86_400_000) },
)

const followWait = waiting(
  { trigger: { type: 'any_dm' }, start: 'c', steps: { c: { type: 'check_follow' } } },
  { currentStepId: 'c', wait: { kind: 'follow_check' }, waitUntil: new Date(NOW.getTime() + 300_000) },
)

const route = (input: Partial<RouteInput> & Pick<RouteInput, 'event'>) =>
  decideRoute({ contact, waitingRun: null, candidates: [], mediaPublishedAt: null, now: NOW, ...input })

describe('decideRoute edge', () => {
  it('a DM that is not a button label falls through to triggers; any_dm defers to the waiting run', () => {
    expect(route({ event: dm('hello'), waitingRun: buttonWait, candidates: [anyDm] })).toEqual({
      kind: 'ignore',
      reason: 'waiting_run_has_priority',
    })
    expect(route({ event: dm('price'), waitingRun: buttonWait, candidates: [anyDm, priceKeyword] })).toMatchObject({
      kind: 'start',
      automationId: 'price',
    })
    expect(route({ event: dm('hello'), waitingRun: buttonWait, candidates: [] })).toEqual({
      kind: 'ignore',
      reason: 'no_matching_automation',
    })
  })

  it('an ask wait swallows any non-empty text, even a keyword for another automation', () => {
    expect(route({ event: dm('price'), waitingRun: askText, candidates: [priceKeyword] })).toMatchObject({
      kind: 'resume',
      runId: 'run1',
    })
  })

  it('a DM with no text never resumes; it can still start keywordless any_dm when nothing waits', () => {
    expect(route({ event: dm(null), waitingRun: askText, candidates: [anyDm] })).toEqual({
      kind: 'ignore',
      reason: 'waiting_run_has_priority',
    })
  })

  it('a DM during a follow check does not resume the run', () => {
    expect(route({ event: dm('I followed'), waitingRun: followWait, candidates: [anyDm] })).toEqual({
      kind: 'ignore',
      reason: 'waiting_run_has_priority',
    })
  })

  it('a story text reply resumes a waiting ask', () => {
    expect(route({ event: story('call me P', false), waitingRun: askText, candidates: [storyAll] })).toMatchObject({
      kind: 'resume',
      event: { type: 'reply', text: 'call me P' },
    })
  })

  // Suspected bug: a story *reaction* (emoji-only, isReaction=true) is fed to the waiting question as an answer.
  // For validate:'text' the emoji gets saved; for email/phone it burns an attempt and sends the retry text.
  it('BUG: a story reaction is not treated as an answer to a waiting question', () => {
    expect(route({ event: story('🔥', true), waitingRun: askText, candidates: [] })).not.toMatchObject({ kind: 'resume' })
  })

  it('a story reply while a run waits starts a story automation (not deferred like any_dm)', () => {
    expect(route({ event: story('🔥', true), waitingRun: followWait, candidates: [storyAll, anyDm] })).toMatchObject({
      kind: 'start',
      automationId: 'story',
      trigger: { kind: 'story', text: '🔥' },
    })
  })

  it('story text not matching story automations falls back to any_dm, which defers to a waiting run', () => {
    const storyKw = candidate('sk', { type: 'story_reply', includeReactions: false, keywords: ['price'] })
    expect(route({ event: story('nice', false), waitingRun: followWait, candidates: [storyKw, anyDm] })).toEqual({
      kind: 'ignore',
      reason: 'waiting_run_has_priority',
    })
  })

  it('comments start automations even when a run is waiting', () => {
    expect(route({ event: comment('guide'), waitingRun: askText, candidates: [guideComment] })).toMatchObject({
      kind: 'start',
      automationId: 'guide',
    })
    expect(route({ event: comment('guide'), waitingRun: askText, candidates: [anyDm] })).toEqual({
      kind: 'ignore',
      reason: 'no_matching_automation',
    })
  })

  it('comment routing uses mediaPublishedAt for next-post automations', () => {
    const next = candidate('next', { type: 'comment_keyword', posts: { mode: 'next' }, keywords: [], match: 'contains' }, new Date('2026-10-01'))
    expect(route({ event: comment('x'), candidates: [next], mediaPublishedAt: new Date('2026-10-02') })).toMatchObject({ kind: 'start' })
    expect(route({ event: comment('x'), candidates: [next], mediaPublishedAt: null })).toMatchObject({ kind: 'ignore' })
  })

  it('unknown or malformed postbacks are ignored with unknown_postback', () => {
    for (const payload of ['', 'GET_STARTED', 'r:run1:s1', 'r:run1:s1:b:extra', 'ib:ib', 'ib:ib:x']) {
      expect(route({ event: postback(payload), candidates: [iceBreaker] }), payload).toEqual({
        kind: 'ignore',
        reason: 'unknown_postback',
      })
    }
  })

  it('run postbacks resume by payload regardless of the waiting run', () => {
    expect(route({ event: postback('r:other:s9:b'), waitingRun: askText })).toEqual({
      kind: 'resume',
      runId: 'other',
      event: { type: 'postback', stepId: 's9', buttonId: 'b' },
    })
  })

  it('ice breaker postbacks start even when a run is waiting; non-ice-breaker automations are rejected', () => {
    expect(route({ event: postback('ib:ib:0'), waitingRun: askText, candidates: [iceBreaker] })).toMatchObject({
      kind: 'start',
      automationId: 'ib',
    })
    expect(route({ event: postback('ib:any:0'), candidates: [anyDm] })).toEqual({ kind: 'ignore', reason: 'unknown_ice_breaker' })
    expect(route({ event: postback('ib:ib:00'), candidates: [iceBreaker] })).toMatchObject({
      kind: 'start',
      trigger: { kind: 'ice_breaker', itemIndex: 0 },
    })
    expect(route({ event: postback('ib:ib:1'), candidates: [iceBreaker] })).toEqual({
      kind: 'ignore',
      reason: 'unknown_ice_breaker',
    })
  })

  it('acceptsReply does not mutate the waiting run', () => {
    const snapshot = structuredClone(askText)
    route({ event: dm('Priya'), waitingRun: askText })
    expect(askText).toEqual(snapshot)
  })
})
