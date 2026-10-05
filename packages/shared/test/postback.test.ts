import { describe, expect, it } from 'vitest'
import { decodePostback, encodePostback } from '../src'

describe('postback payloads', () => {
  it('round-trips run buttons', () => {
    const payload = { kind: 'run', runId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', stepId: 's1', buttonId: 'send_it' } as const
    const raw = encodePostback(payload)
    expect(raw).toBe('r:0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b:s1:send_it')
    expect(decodePostback(raw)).toEqual(payload)
  })

  it('round-trips ice breakers', () => {
    const payload = { kind: 'ice_breaker', automationId: 'a1', itemIndex: 2 } as const
    expect(encodePostback(payload)).toBe('ib:a1:2')
    expect(decodePostback('ib:a1:2')).toEqual(payload)
  })

  it.each(['', 'hello', 'r:a:b', 'r:a:b:c:d', 'ib:a', 'ib:a:x', 'ib:a:-1', 'ib::1', 'r::s1:b1'])(
    'rejects %j',
    (raw) => {
      expect(decodePostback(raw)).toBeNull()
    },
  )
})
