import { describe, expect, it } from 'vitest'
import type { FlowDefinition } from '../src'
import {
  ButtonSchema,
  FlowDefinitionSchema,
  MAX_NUDGE_MINUTES,
  NudgeSchema,
  StepSchema,
  TriggerSchema,
  decodePostback,
  encodePostback,
  matchesKeyword,
  normalizeText,
  validateFlow,
} from '../src'

const codes = (flow: FlowDefinition, platform: 'instagram' | 'facebook' = 'instagram') =>
  validateFlow(flow, platform).map((issue) => issue.code)

const dm = (steps: FlowDefinition['steps'], start = 's1'): FlowDefinition => ({
  trigger: { type: 'any_dm' },
  start,
  steps,
})

describe('schemas edge', () => {
  it('button label: 20 chars ok, 21 rejected, whitespace-only rejected, trimmed before length', () => {
    const reply = (label: string) => ButtonSchema.safeParse({ type: 'reply', id: 'b', label }).success
    expect(reply('x'.repeat(20))).toBe(true)
    expect(reply('x'.repeat(21))).toBe(false)
    expect(reply('   ')).toBe(false)
    expect(reply(`  ${'x'.repeat(20)}  `)).toBe(true)
  })

  it('at most 3 buttons', () => {
    const step = (count: number) => ({
      type: 'send_message',
      text: 'x',
      buttons: Array.from({ length: count }, (_, i) => ({ type: 'reply', id: `b${i}`, label: 'L' })),
    })
    expect(StepSchema.safeParse(step(3)).success).toBe(true)
    expect(StepSchema.safeParse(step(4)).success).toBe(false)
  })

  it('url buttons need a valid url', () => {
    expect(ButtonSchema.safeParse({ type: 'url', label: 'x', url: 'not a url' }).success).toBe(false)
    expect(ButtonSchema.safeParse({ type: 'url', label: 'x', url: 'https://example.com/a?b=c' }).success).toBe(true)
  })

  // BUG: z.url() accepts any scheme (javascript:, data:, ftp:); Meta URL buttons need http(s), so this publishes but fails at send time.
  it('BUG: url buttons reject non-http(s) schemes', () => {
    // A button URL is opened by the recipient; javascript:/data: links should not be publishable.
    expect(ButtonSchema.safeParse({ type: 'url', label: 'x', url: 'javascript:alert(1)' }).success).toBe(false)
    const url = (value: string) => ButtonSchema.safeParse({ type: 'url', label: 'x', url: value }).success
    for (const bad of ['data:text/html,hi', 'ftp://example.com/a', 'mailto:a@b.co', 'https://localhost']) {
      expect(url(bad), bad).toBe(false)
    }
    expect(url('http://example.com')).toBe(true)
    expect(StepSchema.safeParse({ type: 'send_message', text: 'x', imageUrl: 'javascript:alert(1)' }).success).toBe(false)
  })

  it('nudge bounds', () => {
    const nudge = (afterMinutes: number) => NudgeSchema.safeParse({ afterMinutes, text: 'hi' }).success
    expect(nudge(4)).toBe(false)
    expect(nudge(5)).toBe(true)
    expect(nudge(MAX_NUDGE_MINUTES)).toBe(true)
    expect(nudge(MAX_NUDGE_MINUTES + 1)).toBe(false)
    expect(nudge(5.5)).toBe(false)
  })

  it('reply button without next is valid', () => {
    expect(ButtonSchema.safeParse({ type: 'reply', id: 'b', label: 'Done' }).success).toBe(true)
  })

  it('step ids are restricted (no colon, so postback payloads stay parseable)', () => {
    expect(FlowDefinitionSchema.safeParse(dm({ 'a:b': { type: 'send_message', text: 'x' } }, 'a:b')).success).toBe(false)
  })

  it('ice breaker: 1..4 items', () => {
    expect(TriggerSchema.safeParse({ type: 'ice_breaker', items: [] }).success).toBe(false)
    const item = { question: 'Q', startStep: 's1' }
    expect(TriggerSchema.safeParse({ type: 'ice_breaker', items: [item, item, item, item] }).success).toBe(true)
    expect(TriggerSchema.safeParse({ type: 'ice_breaker', items: [item, item, item, item, item] }).success).toBe(false)
  })

  it('dm_keyword needs at least one keyword; comment_keyword may be empty', () => {
    expect(TriggerSchema.safeParse({ type: 'dm_keyword', keywords: [], match: 'contains' }).success).toBe(false)
    expect(
      TriggerSchema.safeParse({ type: 'comment_keyword', posts: { mode: 'any' }, keywords: [], match: 'exact' }).success,
    ).toBe(true)
  })

  it('maxAttempts 1..5 and timeout minutes 1..10080', () => {
    const ask = (maxAttempts: number, timeoutMinutes: number) =>
      StepSchema.safeParse({
        type: 'ask',
        question: 'Q',
        saveTo: 'email',
        validate: 'email',
        retryText: 'R',
        maxAttempts,
        timeoutMinutes,
      }).success
    expect(ask(0, 10)).toBe(false)
    expect(ask(1, 10)).toBe(true)
    expect(ask(6, 10)).toBe(false)
    expect(ask(1, 10081)).toBe(false)
  })
})

describe('validateFlow edge', () => {
  it('reports dangling references in every branch kind', () => {
    const flow = dm({
      s1: {
        type: 'send_message',
        text: 'x',
        buttons: [{ type: 'reply', id: 'a', label: 'A', next: 'gone1' }],
      },
      s2: { type: 'condition', has: 'email', yes: 'gone2' },
      s3: { type: 'check_follow', notFollowing: 'gone3' },
    })
    const issues = validateFlow(flow, 'instagram').filter((i) => i.code === 'missing_target')
    expect(issues.map((i) => i.stepId).sort()).toEqual(['s1', 's2', 's3'])
  })

  it('reports unreachable steps and does not choke on cycles through waits', () => {
    const flow = dm({
      s1: { type: 'send_message', text: 'x', buttons: [{ type: 'reply', id: 'a', label: 'A', next: 's2' }] },
      s2: { type: 'check_follow', following: 's3', notFollowing: 's1' },
      s3: { type: 'send_message', text: 'done' },
      lonely: { type: 'send_message', text: 'never' },
    })
    expect(codes(flow)).toEqual(['orphan_step'])
  })

  it('flags a self-loop and a non-wait cycle', () => {
    expect(codes(dm({ s1: { type: 'tag', add: ['a'], next: 's1' } }))).toContain('cycle_without_wait')
    expect(
      codes(dm({ s1: { type: 'tag', next: 's2' }, s2: { type: 'condition', has: 'email', yes: 's1', no: 's1' } })),
    ).toContain('cycle_without_wait')
  })

  it('a url-only button message does not break a cycle', () => {
    const flow = dm({
      s1: { type: 'send_message', text: 'x', buttons: [{ type: 'url', label: 'Go', url: 'https://x.co' }], next: 's2' },
      s2: { type: 'tag', next: 's1' },
    })
    expect(codes(flow)).toContain('cycle_without_wait')
  })

  // BUG: no uniqueness check on reply-button ids; onPostback picks the first, the second button's branch is dead.
  it('BUG: flags duplicate reply-button ids within one message', () => {
    // onPostback finds the first button with the id, so the second button's branch is unreachable.
    const flow = dm({
      s1: {
        type: 'send_message',
        text: 'x',
        buttons: [
          { type: 'reply', id: 'b', label: 'A', next: 'a' },
          { type: 'reply', id: 'b', label: 'B', next: 'b' },
        ],
      },
      a: { type: 'send_message', text: 'a' },
      b: { type: 'send_message', text: 'b' },
    })
    expect(validateFlow(flow, 'instagram')).not.toEqual([])
  })

  // BUG: runFrom fails with step_budget_exceeded after 50 non-wait steps, but validateFlow accepts the flow.
  it('BUG: flags an acyclic chain longer than the engine step budget (it can never complete)', () => {
    const steps: FlowDefinition['steps'] = {}
    for (let i = 1; i <= 60; i++) steps[`t${i}`] = { type: 'tag', add: ['x'], ...(i < 60 ? { next: `t${i + 1}` } : {}) }
    expect(validateFlow(dm(steps, 't1'), 'instagram')).not.toEqual([])
  })

  // BUG: Keyword schema only trims; matchesKeyword returns false when normalizeText(keyword) is ''.
  it('BUG: flags keywords that normalize to nothing (they can never match)', () => {
    const flow: FlowDefinition = {
      trigger: { type: 'dm_keyword', keywords: ['!!!'], match: 'contains' },
      start: 's1',
      steps: { s1: { type: 'send_message', text: 'x' } },
    }
    expect(TriggerSchema.safeParse(flow.trigger).success).toBe(true)
    expect(validateFlow(flow, 'instagram')).not.toEqual([])
  })

  it('nudge on a send_message without reply buttons is flagged', () => {
    expect(codes(dm({ s1: { type: 'send_message', text: 'x', nudge: { afterMinutes: 10, text: 'n' } } }))).toEqual([
      'nudge_without_wait',
    ])
  })

  it('nudge at/after an ask timeout is flagged; just before is fine', () => {
    const ask = (afterMinutes: number) =>
      dm({
        s1: {
          type: 'ask',
          question: 'Q',
          saveTo: 'email',
          validate: 'email',
          retryText: 'R',
          maxAttempts: 2,
          timeoutMinutes: 60,
          nudge: { afterMinutes, text: 'n' },
        },
      })
    expect(codes(ask(60))).toEqual(['nudge_too_late'])
    expect(codes(ask(59))).toEqual([])
  })

  it('comment flow: start must be a reply-button message; nudge on it is flagged', () => {
    const comment = (first: FlowDefinition['steps'][string]): FlowDefinition => ({
      trigger: { type: 'comment_keyword', posts: { mode: 'any' }, keywords: [], match: 'contains' },
      start: 's1',
      steps: { s1: first },
    })
    expect(codes(comment({ type: 'send_message', text: 'x' }))).toContain('comment_needs_reply_button')
    expect(
      codes(
        comment({
          type: 'ask',
          question: 'Q',
          saveTo: 'email',
          validate: 'email',
          retryText: 'R',
          maxAttempts: 1,
          timeoutMinutes: 10,
        }),
      ),
    ).toContain('comment_needs_reply_button')
    expect(
      codes(
        comment({
          type: 'send_message',
          text: 'x',
          buttons: [{ type: 'reply', id: 'b', label: 'B' }],
          nudge: { afterMinutes: 10, text: 'n' },
        }),
      ),
    ).toEqual(['nudge_after_private_reply'])
  })

  it('specific posts with no media ids is flagged', () => {
    const flow: FlowDefinition = {
      trigger: { type: 'comment_keyword', posts: { mode: 'specific', mediaIds: [] }, keywords: [], match: 'contains' },
      start: 's1',
      steps: { s1: { type: 'send_message', text: 'x', buttons: [{ type: 'reply', id: 'b', label: 'B' }] } },
    }
    expect(codes(flow)).toEqual(['no_posts_selected'])
  })

  it('facebook: story triggers and check_follow are unsupported (check_follow reported once)', () => {
    const flow: FlowDefinition = {
      trigger: { type: 'story_reply', includeReactions: true },
      start: 's1',
      steps: { s1: { type: 'check_follow', following: 's2', notFollowing: 's2' }, s2: { type: 'check_follow' } },
    }
    expect(codes(flow, 'facebook')).toEqual(['platform_unsupported', 'platform_unsupported'])
  })

  it('ice breaker entries count as reachable; missing entry steps are reported', () => {
    const flow: FlowDefinition = {
      trigger: { type: 'ice_breaker', items: [{ question: 'A', startStep: 'a' }, { question: 'B', startStep: 'nope' }] },
      start: 's1',
      steps: { s1: { type: 'send_message', text: '1' }, a: { type: 'send_message', text: 'a' } },
    }
    expect(codes(flow)).toEqual(['missing_start'])
  })

  // BUG: findCyclesWithoutWait recurses once per step (~10k steps overflows; steps record is unbounded).
  it('BUG: handles a deep chain without stack overflow', () => {
    const steps: FlowDefinition['steps'] = {}
    const n = 20_000
    for (let i = 1; i <= n; i++) steps[`t${i}`] = { type: 'tag', ...(i < n ? { next: `t${i + 1}` } : {}) }
    expect(() => validateFlow(dm(steps, 't1'), 'instagram')).not.toThrow()
  })
})

describe('keywords / postback edge', () => {
  it('normalizeText', () => {
    expect(normalizeText('  Hello,   WORLD!! ')).toBe('hello world')
    expect(normalizeText('free_guide')).toBe('free guide')
    expect(normalizeText('???')).toBe('')
  })

  it('exact match with an empty keyword never matches empty text', () => {
    expect(matchesKeyword('', '', 'exact')).toBe(false)
    expect(matchesKeyword('...', '!!!', 'exact')).toBe(false)
  })

  it('postback round trip and rejects malformed payloads', () => {
    const payload = { kind: 'run', runId: 'r1', stepId: 's1', buttonId: 'b1' } as const
    expect(decodePostback(encodePostback(payload))).toEqual(payload)
    expect(decodePostback(encodePostback({ kind: 'ice_breaker', automationId: 'a', itemIndex: 3 }))).toEqual({
      kind: 'ice_breaker',
      automationId: 'a',
      itemIndex: 3,
    })
    for (const raw of ['', 'r:', 'r:a:b', 'r:a:b:c:d', 'r::s:b', 'ib:a', 'ib:a:-1', 'ib:a:1.5', 'ib::0', 'ib:a:', 'x:a:b:c']) {
      expect(decodePostback(raw), raw).toBeNull()
    }
  })
})
