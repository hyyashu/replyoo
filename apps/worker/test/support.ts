import type { Db } from '@replyooo/db'
import {
  authUsers,
  automationVersions,
  automations,
  connectedAccounts,
  contacts,
  createDb,
  encryptToken,
  flowRuns,
  subscriptions,
  usageCounters,
  webhookEvents,
  workspaceMembers,
  workspaces,
} from '@replyooo/db'
import { RecordingMailer } from '@replyooo/email/testing'
import type { FlowRunState } from '@replyooo/engine'
import { newRunState } from '@replyooo/engine'
import type {
  AccountCredentials,
  IceBreaker,
  MetaError,
  NormalizedEvent,
  PlatformAdapter,
  AccountProfile,
  Profile,
  SendableMessage,
} from '@replyooo/meta'
import { normalizeFacebookWebhook, normalizeInstagramWebhook } from '@replyooo/meta'
import type { FlowDefinition, Platform } from '@replyooo/shared'
import { usagePeriod } from '@replyooo/shared'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { pino } from 'pino'
import { afterAll, inject } from 'vitest'
import type { Deps, FlowJobData, FollowCheckJobData, Jobs, OutboundJobData, RateLimiter } from '../src/deps'
import { runColumns } from '../src/records'

export const TOKEN_KEY = Buffer.alloc(32, 7)
export const NOW = new Date('2026-10-06T10:00:00.000Z')

// ---------- database ----------

let shared: { db: Db; close: () => Promise<void> } | undefined

/** One connection pool per test file, closed after the file. */
export function useDb(): Db {
  if (!shared) {
    shared = createDb(inject('databaseUrl'))
    afterAll(async () => {
      await shared?.close()
      shared = undefined
    })
  }
  return shared.db
}

// ---------- fakes ----------

export class RecordingJobs implements Jobs {
  inbounds: string[] = []
  flows: { data: FlowJobData; opts?: { at?: Date; jobId?: string } }[] = []
  followChecks: FollowCheckJobData[] = []
  outbounds: OutboundJobData[] = []

  async inbound(webhookEventId: string) {
    this.inbounds.push(webhookEventId)
  }
  async flow(data: FlowJobData, opts?: { at?: Date; jobId?: string }) {
    this.flows.push(opts ? { data, opts } : { data })
  }
  async followCheck(data: FollowCheckJobData) {
    this.followChecks.push(data)
  }
  async outbound(data: OutboundJobData) {
    this.outbounds.push(data)
  }
  clear() {
    this.inbounds = []
    this.flows = []
    this.followChecks = []
    this.outbounds = []
  }
}

export interface FakeCall {
  method: string
  args: unknown[]
}

export class FakeAdapter implements PlatformAdapter {
  calls: FakeCall[] = []
  /** Thrown, in order, by the next send/reply/follow calls. */
  errors: MetaError[] = []
  following = false
  profile: Profile = { name: 'Priya Sharma', username: 'priya', avatarUrl: null }
  accountProfile: AccountProfile = { displayName: 'Acme Co', avatarUrl: 'https://cdn.example/new.jpg', followersCount: 321 }
  mediaPublishedAt: Date | null = null
  private counter = 0

  constructor(readonly platform: Platform) {}

  normalizeWebhook(payload: unknown): NormalizedEvent[] {
    return this.platform === 'instagram' ? normalizeInstagramWebhook(payload) : normalizeFacebookWebhook(payload)
  }

  private act(method: string, args: unknown[]) {
    this.calls.push({ method, args })
    const error = this.errors.shift()
    if (error) throw error
    return { messageId: `${method}-${++this.counter}` }
  }

  async sendMessage(_: AccountCredentials, recipientId: string, message: SendableMessage) {
    return this.act('sendMessage', [recipientId, message])
  }
  async sendPrivateReply(_: AccountCredentials, commentId: string, message: SendableMessage) {
    return this.act('sendPrivateReply', [commentId, message])
  }
  async replyToComment(_: AccountCredentials, commentId: string, text: string) {
    return this.act('replyToComment', [commentId, text])
  }
  async getProfile(_: AccountCredentials, userId: string) {
    this.calls.push({ method: 'getProfile', args: [userId] })
    return this.profile
  }
  async getAccountProfile(_: AccountCredentials) {
    this.calls.push({ method: 'getAccountProfile', args: [] })
    const error = this.errors.shift()
    if (error) throw error
    return this.accountProfile
  }
  async getMediaPublishedAt(_: AccountCredentials, mediaId: string) {
    this.calls.push({ method: 'getMediaPublishedAt', args: [mediaId] })
    return this.mediaPublishedAt
  }
  async listMedia() {
    return []
  }
  async reactToMessage(_: AccountCredentials, recipientId: string, messageId: string) {
    this.act('reactToMessage', [recipientId, messageId])
  }
  async isFollower(_: AccountCredentials, userId: string) {
    this.act('isFollower', [userId])
    return this.following
  }
  async setIceBreakers(_: AccountCredentials, items: IceBreaker[]) {
    this.calls.push({ method: 'setIceBreakers', args: [items] })
  }
  async subscribeWebhooks() {
    this.calls.push({ method: 'subscribeWebhooks', args: [] })
  }
  async refreshToken(account: AccountCredentials) {
    this.act('refreshToken', [])
    return { accessToken: `${account.accessToken}-refreshed`, expiresAt: new Date(NOW.getTime() + 60 * 86_400_000) }
  }

  sent(method?: string): FakeCall[] {
    return method ? this.calls.filter((c) => c.method === method) : this.calls
  }
}

export const allowAll: RateLimiter = { take: async () => 0 }

export interface TestContext {
  deps: Deps
  jobs: RecordingJobs
  adapters: { instagram: FakeAdapter; facebook: FakeAdapter }
  clock: { now: Date }
  mailer: RecordingMailer
}

export function createTestContext(overrides: Partial<Deps> = {}): TestContext {
  const jobs = new RecordingJobs()
  const adapters = { instagram: new FakeAdapter('instagram'), facebook: new FakeAdapter('facebook') }
  const clock = { now: NOW }
  const mailer = new RecordingMailer()
  const deps: Deps = {
    db: useDb(),
    jobs,
    adapters,
    rateLimiter: allowAll,
    tokenKey: TOKEN_KEY,
    log: pino({ level: 'silent' }),
    now: () => clock.now,
    mailer,
    appUrl: 'http://localhost:3000',
    ...overrides,
  }
  return { deps, jobs, adapters, clock, mailer }
}

// ---------- seeding ----------

export async function seedAccount(db: Db, opts: { platform?: Platform; tokenExpiresAt?: Date | null } = {}) {
  const [workspace] = await db.insert(workspaces).values({ name: 'Acme', ownerUserId: 'user_1' }).returning()
  const platform = opts.platform ?? 'instagram'
  const [account] = await db
    .insert(connectedAccounts)
    .values({
      workspaceId: workspace!.id,
      platform,
      externalId: `${platform}_${randomUUID()}`,
      username: 'acme',
      accessTokenEnc: encryptToken('token-abc', TOKEN_KEY),
      tokenExpiresAt: opts.tokenExpiresAt ?? null,
    })
    .returning()
  return { workspace: workspace!, account: account! }
}

export type AccountRow = Awaited<ReturnType<typeof seedAccount>>['account']

export async function publishAutomation(
  db: Db,
  account: AccountRow,
  definition: FlowDefinition,
  opts: { publishedAt?: Date; pinnedMediaId?: string } = {},
) {
  const [automation] = await db
    .insert(automations)
    .values({
      workspaceId: account.workspaceId,
      connectedAccountId: account.id,
      name: 'Test automation',
      status: 'active',
      triggerType: definition.trigger.type,
      definition,
      pinnedMediaId: opts.pinnedMediaId ?? null,
    })
    .returning()
  const [version] = await db
    .insert(automationVersions)
    .values({ automationId: automation!.id, version: 1, definition, publishedAt: opts.publishedAt ?? NOW })
    .returning()
  await db.update(automations).set({ currentVersionId: version!.id }).where(eq(automations.id, automation!.id))
  return { automation: automation!, version: version! }
}

export async function seedContact(
  db: Db,
  account: AccountRow,
  values: Partial<typeof contacts.$inferInsert> = {},
) {
  const [contact] = await db
    .insert(contacts)
    .values({
      workspaceId: account.workspaceId,
      connectedAccountId: account.id,
      platformUserId: `user_${randomUUID()}`,
      lastInboundAt: NOW,
      ...values,
    })
    .returning()
  return contact!
}

export async function insertEvent(db: Db, event: NormalizedEvent): Promise<string> {
  const [row] = await db
    .insert(webhookEvents)
    .values({ platform: event.platform, dedupKey: event.dedupKey, payload: event })
    .returning({ id: webhookEvents.id })
  return row!.id
}

// ---------- normalized event builders ----------

const base = (account: AccountRow, senderId: string) => ({
  platform: account.platform,
  accountExternalId: account.externalId,
  senderId,
  occurredAt: NOW.toISOString(),
})

export const dm = (account: AccountRow, senderId: string, text: string | null): NormalizedEvent => {
  const id = randomUUID()
  return { ...base(account, senderId), type: 'dm_received', dedupKey: `t:${id}`, messageId: id, text }
}

export const story = (account: AccountRow, senderId: string, text: string | null, isReaction = false, storyId: string | null = null): NormalizedEvent => {
  const id = randomUUID()
  return { ...base(account, senderId), type: 'story_reply', dedupKey: `t:${id}`, messageId: id, storyId, text, isReaction }
}

export const postback = (account: AccountRow, senderId: string, payload: string): NormalizedEvent => {
  const id = randomUUID()
  return { ...base(account, senderId), type: 'postback', dedupKey: `t:${id}`, messageId: id, payload, title: null }
}

export const comment = (
  account: AccountRow,
  senderId: string,
  text: string,
  opts: { mediaId?: string; commentId?: string } = {},
): NormalizedEvent => {
  const commentId = opts.commentId ?? `c_${randomUUID()}`
  return {
    ...base(account, senderId),
    type: 'comment_created',
    dedupKey: `t:${commentId}`,
    commentId,
    mediaId: opts.mediaId ?? 'media1',
    text,
    senderUsername: 'priya',
    senderName: null,
  }
}

export async function insertRun(
  db: Db,
  refs: {
    account: AccountRow
    contact: { id: string }
    automation: { id: string }
    version: { id: string }
  },
  state: Partial<FlowRunState> = {},
) {
  const [run] = await db
    .insert(flowRuns)
    .values({
      automationId: refs.automation.id,
      automationVersionId: refs.version.id,
      contactId: refs.contact.id,
      connectedAccountId: refs.account.id,
      ...runColumns({ ...newRunState(), ...state }, NOW),
    })
    .returning()
  return run!
}

export async function seedUsage(
  db: Db,
  workspaceId: string,
  contactsReached: number,
  subscription?: { plan: 'free' | 'pro' | 'business'; status?: string; currentPeriodEnd?: Date | null },
) {
  await db.insert(usageCounters).values({ workspaceId, period: usagePeriod(NOW), contactsReached })
  if (subscription) {
    await db.insert(subscriptions).values({
      workspaceId,
      plan: subscription.plan,
      status: subscription.status ?? 'active',
      currentPeriodEnd: subscription.currentPeriodEnd ?? null,
    })
  }
}

/** A workspace member with a real user row; returns the member's email. */
export async function seedMember(db: Db, workspaceId: string, role: 'owner' | 'admin' | 'member'): Promise<string> {
  const id = randomUUID()
  const email = `${role}-${id}@example.com`
  await db.insert(authUsers).values({ id, name: role, email })
  await db.insert(workspaceMembers).values({ workspaceId, userId: id, role })
  return email
}
