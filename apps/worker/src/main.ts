import { serve } from '@hono/node-server'
import { createDb, parseEncryptionKey } from '@replyooo/db'
import { createMailer, parseEmailConfig } from '@replyooo/email'
import { createFacebookAdapter, createInstagramAdapter } from '@replyooo/meta'
import { Redis } from 'ioredis'
import type { Deps } from './deps'
import { loadEnv } from './env'
import { createLogger } from './logger'
import { closeQueues, createBullJobs, createQueues, scheduleMaintenance, startWorkers } from './queues'
import { createRedisRateLimiter } from './rate-limit'
import { createServer } from './server'

const env = loadEnv()
const log = createLogger(env.LOG_LEVEL)
const mailer = createMailer(parseEmailConfig(process.env), { print: (line) => log.info(line) })
const { db, close: closeDb } = createDb(env.DATABASE_URL)
const redis = new Redis(env.REDIS_URL)
const queues = createQueues(env.REDIS_URL)

const deps: Deps = {
  db,
  jobs: createBullJobs(queues),
  adapters: {
    instagram: createInstagramAdapter({ graphVersion: env.META_GRAPH_VERSION }),
    facebook: createFacebookAdapter({ graphVersion: env.META_GRAPH_VERSION }),
  },
  rateLimiter: createRedisRateLimiter(redis, env.OUTBOUND_RATE_PER_SECOND),
  tokenKey: parseEncryptionKey(env.TOKEN_ENCRYPTION_KEY),
  log,
  now: () => new Date(),
  mailer,
  appUrl: env.APP_URL,
}

const workers = startWorkers(deps, env.REDIS_URL)
await scheduleMaintenance(queues)

const app = createServer(deps, {
  verifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
  appSecrets: [env.META_APP_SECRET, env.INSTAGRAM_APP_SECRET],
})
const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => log.info({ port: info.port }, 'worker listening'))

let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  log.info({ signal }, 'shutting down')
  server.close()
  await Promise.all(workers.map((worker) => worker.close()))
  await closeQueues(queues)
  await redis.quit()
  await closeDb()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
