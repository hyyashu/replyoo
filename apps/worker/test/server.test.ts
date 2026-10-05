import { webhookEvents } from '@replyooo/db'
import { inArray } from 'drizzle-orm'
import { createHmac, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createServer } from '../src/server'
import { verifySignature } from '../src/webhooks'
import { createTestContext } from './support'

const config = { verifyToken: 'verify-me', appSecrets: ['fb-secret', 'ig-secret'] }
const sign = (body: string, secret = 'ig-secret') =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

function igDmPayload(mids: string[]) {
  return JSON.stringify({
    object: 'instagram',
    entry: [
      {
        id: 'ig_acct',
        time: 1791280800000,
        messaging: mids.map((mid) => ({
          sender: { id: 'igsid_1' },
          recipient: { id: 'ig_acct' },
          timestamp: 1791280800000,
          message: { mid, text: 'hi' },
        })),
      },
    ],
  })
}

describe('verifySignature', () => {
  const body = Buffer.from('{"a":1}')
  it('accepts either configured secret', () => {
    expect(verifySignature(body, sign('{"a":1}', 'fb-secret'), config.appSecrets)).toBe(true)
    expect(verifySignature(body, sign('{"a":1}', 'ig-secret'), config.appSecrets)).toBe(true)
  })
  it('rejects wrong, missing and malformed signatures', () => {
    expect(verifySignature(body, sign('{"a":1}', 'other'), config.appSecrets)).toBe(false)
    expect(verifySignature(body, undefined, config.appSecrets)).toBe(false)
    expect(verifySignature(body, 'sha256=abc', config.appSecrets)).toBe(false)
    expect(verifySignature(body, 'md5=abc', config.appSecrets)).toBe(false)
  })
})

describe('webhook server', () => {
  it('answers the subscription handshake', async () => {
    const app = createServer(createTestContext().deps, config)
    const ok = await app.request('/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42')
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe('42')
    const bad = await app.request('/webhooks/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42')
    expect(bad.status).toBe(403)
    expect((await app.request('/health')).status).toBe(200)
  })

  it('rejects bad signatures and bad JSON', async () => {
    const { deps, jobs } = createTestContext()
    const app = createServer(deps, config)
    const body = igDmPayload([`mid.${randomUUID()}`])
    const unsigned = await app.request('/webhooks/meta', { method: 'POST', body })
    expect(unsigned.status).toBe(401)
    const badJson = await app.request('/webhooks/meta', {
      method: 'POST',
      body: '{nope',
      headers: { 'x-hub-signature-256': sign('{nope') },
    })
    expect(badJson.status).toBe(400)
    expect(jobs.inbounds).toEqual([])
  })

  it('stores each event and enqueues inbound jobs', async () => {
    const { deps, jobs } = createTestContext()
    const app = createServer(deps, config)
    const mids = [`mid.${randomUUID()}`, `mid.${randomUUID()}`]
    const body = igDmPayload(mids)
    const res = await app.request('/webhooks/meta', {
      method: 'POST',
      body,
      headers: { 'x-hub-signature-256': sign(body), 'content-type': 'application/json' },
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('EVENT_RECEIVED')
    const rows = await deps.db
      .select()
      .from(webhookEvents)
      .where(inArray(webhookEvents.dedupKey, mids.map((m) => `instagram:message:${m}`)))
    expect(rows).toHaveLength(2)
    expect(jobs.inbounds.sort()).toEqual(rows.map((r) => r.id).sort())
  })

  it('stores duplicate deliveries once', async () => {
    const { deps, jobs } = createTestContext()
    const app = createServer(deps, config)
    const mid = `mid.${randomUUID()}`
    const body = igDmPayload([mid, mid])
    const send = () =>
      app.request('/webhooks/meta', { method: 'POST', body, headers: { 'x-hub-signature-256': sign(body) } })
    expect((await send()).status).toBe(200)
    expect((await send()).status).toBe(200)
    const rows = await deps.db
      .select()
      .from(webhookEvents)
      .where(inArray(webhookEvents.dedupKey, [`instagram:message:${mid}`]))
    expect(rows).toHaveLength(1)
    expect(jobs.inbounds).toEqual([rows[0]!.id])
  })

  it('acknowledges payloads it does not handle', async () => {
    const { deps, jobs } = createTestContext()
    const app = createServer(deps, config)
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] })
    const res = await app.request('/webhooks/meta', {
      method: 'POST',
      body,
      headers: { 'x-hub-signature-256': sign(body) },
    })
    expect(res.status).toBe(200)
    expect(jobs.inbounds).toEqual([])
  })
})
