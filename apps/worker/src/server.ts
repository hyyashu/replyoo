import { Hono } from 'hono'
import type { Deps } from './deps'
import { ingestWebhook, verifySignature } from './webhooks'

export interface ServerConfig {
  verifyToken: string
  appSecrets: string[]
}

export function createServer(deps: Deps, config: ServerConfig): Hono {
  const app = new Hono()

  app.get('/health', (c) => c.json({ ok: true }))

  app.get('/webhooks/meta', (c) => {
    const challenge = c.req.query('hub.challenge')
    if (c.req.query('hub.mode') === 'subscribe' && c.req.query('hub.verify_token') === config.verifyToken && challenge) {
      return c.text(challenge)
    }
    return c.text('Forbidden', 403)
  })

  app.post('/webhooks/meta', async (c) => {
    const raw = Buffer.from(await c.req.arrayBuffer())
    if (!verifySignature(raw, c.req.header('x-hub-signature-256'), config.appSecrets)) {
      return c.text('Invalid signature', 401)
    }
    let body: unknown
    try {
      body = JSON.parse(raw.toString('utf8'))
    } catch {
      return c.text('Invalid JSON', 400)
    }
    try {
      const result = await ingestWebhook(deps, body)
      deps.log.debug(result, 'webhook ingested')
    } catch (error) {
      deps.log.error({ err: error }, 'webhook ingestion failed')
      return c.text('Retry later', 500)
    }
    return c.text('EVENT_RECEIVED')
  })

  return app
}
