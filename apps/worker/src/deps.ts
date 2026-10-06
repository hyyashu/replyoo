import type { Db } from '@replyooo/db'
import type { Mailer } from '@replyooo/email'
import type { EngineEvent } from '@replyooo/engine'
import type { PlatformAdapter } from '@replyooo/meta'
import type { Platform } from '@replyooo/shared'
import type { Logger } from './logger'

export interface FlowJobData {
  runId: string
  event: EngineEvent
  /** Required for timeouts and follow results; the job is a no-op if the run moved on. */
  expectedVersion?: number
}

export interface FollowCheckJobData {
  runId: string
  expectedVersion: number
}

export interface OutboundJobData {
  /** Sent in order, one Graph call each. */
  messageIds: string[]
}

export interface Jobs {
  inbound(webhookEventId: string): Promise<void>
  flow(data: FlowJobData, opts?: { at?: Date; jobId?: string }): Promise<void>
  followCheck(data: FollowCheckJobData): Promise<void>
  outbound(data: OutboundJobData): Promise<void>
}

export interface RateLimiter {
  /** Returns 0 when the call may go now, otherwise how many ms to wait. */
  take(key: string): Promise<number>
}

export interface Deps {
  db: Db
  jobs: Jobs
  adapters: Record<Platform, PlatformAdapter>
  rateLimiter: RateLimiter
  tokenKey: Buffer
  log: Logger
  now: () => Date
  mailer: Mailer
  /** Public web origin (APP_URL), for links in emails. */
  appUrl: string
}
