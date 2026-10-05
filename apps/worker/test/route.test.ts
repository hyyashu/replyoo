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
  text,
  isReaction,
})
const postback = (payload: string): NormalizedEvent => ({
  ...base,
  type: 'postback',
  dedupKey: 'd',
  messageId: 'm',
  payload,
  title: null,
})
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

const candidate = (automationId: string, trigger: Trigger): TriggerCandidate => ({
  automationId,
  publishedAt: NOW,
  trigger,
})
const anyDm = candidate('any', { type: 'any_dm' })
const priceKeyword = candidate('price', { type: 'dm_keyword', keywords: ['price'], match: 'contains' })
const guideComment = candidate('guide', {
  type: 'comment_keyword',
  posts: { mode: 'any' },
  keywords: ['guide'],
  match: 'contains',
})
const iceBreaker = candidate('ib', {
  type: 'ice_breaker',
  items: [
    { question: 'Pricing?', startStep: 's1' },
    { question: 'Hours?', startStep: 's1' },
  ],
})
const storyReactions = candidate('story', { type: 'story_reply', includeReactions: true })

const waiting = (flow: FlowDefinition, state: Partial<FlowRunState>): WaitingRun => ({
  id: 'run1',
  flow,
  run: { ...newRunState(), status: 'waiting', stateVersion: 1, ...state },
})

const askEmail = waiting(
  {
    trigger: { type: 'dm_keyword', keywords: ['guide'], match: 'contains' },
    start: 'ask',
    steps: {
      ask: {
        type: 'ask',
        question: 'Email?',
        saveTo: 'email',
        validate: 'email',
        retryText: 'Try again',
        maxAttempts: 2,
        timeoutMinutes: 1440,
      },
    },
  },
  { currentStepId: 'ask', wait: { kind: 'reply', attempts: 0 }, waitUntil: new Date(NOW.getTime() + 86_400_000) },
)

const inDelay = waiting(
  { trigger: { type: 'any_dm' }, start: 'd', steps: { d: { type: 'delay', minutes: 60 } } },
  { currentStepId: 'd', wait: { kind: 'delay' }, waitUntil: new Date(NOW.getTime() + 3_600_000) },
)

const buttonWait = waiting(
  {
    trigger: { type: 'any_dm' },
    start: 's1',
    steps: {
      s1: {
        type: 'send_message',
        text: 'Want it?',
        buttons: [{ type: 'reply', id: 'yes', label: 'Send it', next: 's2' }],
      },
      s2: { type: 'send_message', text: 'Here' },
    },
  },
  { currentStepId: 's1', wait: { kind: 'postback' }, waitUntil: new Date(NOW.getTime() + 86_400_000) },
)

const route = (input: Partial<RouteInput> & Pick<RouteInput, 'event'>) =>
  decideRoute({ contact, waitingRun: null, candidates: [], mediaPublishedAt: null, now: NOW, ...input })

describe('decideRoute', () => {
  it('starts comment automations on matching comments', () => {
    expect(route({ event: comment('GUIDE pls'), candidates: [guideComment, anyDm] })).toEqual({
      kind: 'start',
      automationId: 'guide',
      trigger: { kind: 'comment', commentId: 'c1', text: 'GUIDE pls' },
    })
    expect(route({ event: comment('nice'), candidates: [guideComment] })).toMatchObject({ kind: 'ignore' })
  })

  it('starts DM automations by keyword, falling back to any_dm', () => {
    expect(route({ event: dm('price?'), candidates: [anyDm, priceKeyword] })).toMatchObject({
      kind: 'start',
      automationId: 'price',
      trigger: { kind: 'dm', text: 'price?' },
    })
    expect(route({ event: dm(null), candidates: [anyDm] })).toMatchObject({
      kind: 'start',
      automationId: 'any',
      trigger: { kind: 'dm', text: '' },
    })
    expect(route({ event: dm('hello'), candidates: [priceKeyword] })).toMatchObject({ kind: 'ignore' })
  })

  it('a valid answer resumes the waiting run even when any_dm matches', () => {
    expect(route({ event: dm("it's PRIYA@Gmail.com"), waitingRun: askEmail, candidates: [anyDm] })).toEqual({
      kind: 'resume',
      runId: 'run1',
      event: { type: 'reply', text: "it's PRIYA@Gmail.com" },
    })
  })

  it('an invalid answer still goes to the ask step (it re-asks)', () => {
    expect(route({ event: dm('no thanks'), waitingRun: askEmail, candidates: [anyDm] })).toMatchObject({
      kind: 'resume',
      runId: 'run1',
    })
  })

  it('typing a button label resumes a button wait', () => {
    expect(route({ event: dm('send it'), waitingRun: buttonWait, candidates: [anyDm] })).toMatchObject({
      kind: 'resume',
      event: { type: 'reply', text: 'send it' },
    })
  })

  it('a waiting run blocks any_dm but not keyword automations', () => {
    expect(route({ event: dm('hello'), waitingRun: inDelay, candidates: [anyDm] })).toEqual({
      kind: 'ignore',
      reason: 'waiting_run_has_priority',
    })
    expect(route({ event: dm('price'), waitingRun: inDelay, candidates: [anyDm, priceKeyword] })).toMatchObject({
      kind: 'start',
      automationId: 'price',
    })
  })

  it('routes flow button postbacks to their run', () => {
    expect(route({ event: postback('r:run9:s1:yes') })).toEqual({
      kind: 'resume',
      runId: 'run9',
      event: { type: 'postback', stepId: 's1', buttonId: 'yes' },
    })
  })

  it('starts ice breakers and ignores unknown postbacks', () => {
    expect(route({ event: postback('ib:ib:1'), candidates: [iceBreaker] })).toEqual({
      kind: 'start',
      automationId: 'ib',
      trigger: { kind: 'ice_breaker', itemIndex: 1 },
    })
    expect(route({ event: postback('ib:ib:7'), candidates: [iceBreaker] })).toMatchObject({ kind: 'ignore' })
    expect(route({ event: postback('ib:gone:0'), candidates: [iceBreaker] })).toMatchObject({ kind: 'ignore' })
    expect(route({ event: postback('GET_STARTED') })).toMatchObject({ kind: 'ignore' })
  })

  it('starts story automations for reactions', () => {
    expect(route({ event: story('🔥', true), candidates: [storyReactions, anyDm] })).toEqual({
      kind: 'start',
      automationId: 'story',
      trigger: { kind: 'story', text: '🔥' },
    })
  })
})
