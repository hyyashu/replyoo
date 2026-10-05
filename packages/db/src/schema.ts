import type { FlowDefinition } from '@replyooo/shared'
import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

const id = () => uuid('id').primaryKey().default(sql`uuidv7()`)
const tz = (name: string) => timestamp(name, { withTimezone: true })
const timestamps = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}

export const platformEnum = pgEnum('platform', ['instagram', 'facebook'])
export const memberRoleEnum = pgEnum('member_role', ['owner', 'admin', 'member'])
export const accountStatusEnum = pgEnum('account_status', ['active', 'reauth_required', 'disconnected'])
export const automationStatusEnum = pgEnum('automation_status', ['draft', 'active', 'paused'])
export const runStatusEnum = pgEnum('run_status', [
  'running',
  'waiting',
  'completed',
  'failed',
  'expired',
  'cancelled',
])
export const outboundModeEnum = pgEnum('outbound_mode', ['dm', 'private_reply', 'blocked'])
export const messageDirectionEnum = pgEnum('message_direction', ['in', 'out'])
export const messageKindEnum = pgEnum('message_kind', [
  'dm',
  'private_reply',
  'comment_reply',
  'postback',
  'story_reply',
  'comment',
])
export const messageStatusEnum = pgEnum('message_status', ['queued', 'sent', 'failed', 'received'])
export const planEnum = pgEnum('plan', ['free', 'pro', 'business'])

// ---------- tenancy ----------

export const workspaces = pgTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  ownerUserId: text('owner_user_id').notNull(),
  ...timestamps,
})

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    role: memberRoleEnum('role').notNull().default('member'),
    ...timestamps,
  },
  (t) => [uniqueIndex('workspace_members_workspace_user_uq').on(t.workspaceId, t.userId)],
)

// ---------- accounts ----------

export const connectedAccounts = pgTable(
  'connected_accounts',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    platform: platformEnum('platform').notNull(),
    externalId: text('external_id').notNull(),
    username: text('username').notNull(),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    accessTokenEnc: text('access_token_enc').notNull(),
    tokenExpiresAt: tz('token_expires_at'),
    status: accountStatusEnum('status').notNull().default('active'),
    connectedByUserId: text('connected_by_user_id'),
    ...timestamps,
  },
  (t) => [uniqueIndex('connected_accounts_platform_external_uq').on(t.platform, t.externalId)],
)

// ---------- audience ----------

export const contacts = pgTable(
  'contacts',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    connectedAccountId: uuid('connected_account_id')
      .notNull()
      .references(() => connectedAccounts.id, { onDelete: 'cascade' }),
    platformUserId: text('platform_user_id').notNull(),
    username: text('username'),
    name: text('name'),
    avatarUrl: text('avatar_url'),
    email: text('email'),
    phone: text('phone'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    fields: jsonb('fields').$type<Record<string, string>>().notNull().default({}),
    lastInboundAt: tz('last_inbound_at'),
    /** `YYYY-MM` of the last period this contact was counted in usage_counters. */
    lastCountedPeriod: text('last_counted_period'),
    firstSeenAt: tz('first_seen_at').notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('contacts_account_platform_user_uq').on(t.connectedAccountId, t.platformUserId),
    index('contacts_workspace_idx').on(t.workspaceId),
    index('contacts_tags_gin').using('gin', t.tags),
  ],
)

// ---------- automations ----------

export const automations = pgTable(
  'automations',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    connectedAccountId: uuid('connected_account_id')
      .notNull()
      .references(() => connectedAccounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    status: automationStatusEnum('status').notNull().default('draft'),
    triggerType: text('trigger_type').notNull(),
    definition: jsonb('definition').$type<FlowDefinition>().notNull(),
    currentVersionId: uuid('current_version_id').references((): AnyPgColumn => automationVersions.id, {
      onDelete: 'set null',
    }),
    templateKey: text('template_key'),
    pinnedMediaId: text('pinned_media_id'),
    ...timestamps,
  },
  (t) => [index('automations_account_status_idx').on(t.connectedAccountId, t.status)],
)

export const automationVersions = pgTable(
  'automation_versions',
  {
    id: id(),
    automationId: uuid('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    definition: jsonb('definition').$type<FlowDefinition>().notNull(),
    publishedAt: tz('published_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('automation_versions_automation_version_uq').on(t.automationId, t.version)],
)

export const automationEntries = pgTable(
  'automation_entries',
  {
    id: id(),
    automationId: uuid('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    lastEnteredAt: tz('last_entered_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('automation_entries_automation_contact_uq').on(t.automationId, t.contactId)],
)

// ---------- execution ----------

export const flowRuns = pgTable(
  'flow_runs',
  {
    id: id(),
    automationId: uuid('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    automationVersionId: uuid('automation_version_id')
      .notNull()
      .references(() => automationVersions.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    connectedAccountId: uuid('connected_account_id')
      .notNull()
      .references(() => connectedAccounts.id, { onDelete: 'cascade' }),
    status: runStatusEnum('status').notNull().default('running'),
    currentStepId: text('current_step_id'),
    wait: jsonb('wait').$type<Record<string, unknown> | null>(),
    waitUntil: tz('wait_until'),
    vars: jsonb('vars').$type<Record<string, string>>().notNull().default({}),
    stateVersion: integer('state_version').notNull().default(0),
    outbound: outboundModeEnum('outbound').notNull().default('dm'),
    commentId: text('comment_id'),
    triggerRef: jsonb('trigger_ref').$type<Record<string, unknown>>(),
    error: text('error'),
    completedAt: tz('completed_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('flow_runs_one_waiting_per_contact')
      .on(t.contactId)
      .where(sql`${t.status} = 'waiting'`),
    index('flow_runs_status_wait_until_idx').on(t.status, t.waitUntil),
  ],
)

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: id(),
    platform: platformEnum('platform').notNull(),
    dedupKey: text('dedup_key').notNull(),
    payload: jsonb('payload').notNull(),
    receivedAt: tz('received_at').notNull().defaultNow(),
    processedAt: tz('processed_at'),
    error: text('error'),
  },
  (t) => [
    uniqueIndex('webhook_events_dedup_key_uq').on(t.dedupKey),
    index('webhook_events_received_at_idx').on(t.receivedAt),
  ],
)

export const messages = pgTable(
  'messages',
  {
    id: id(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    connectedAccountId: uuid('connected_account_id')
      .notNull()
      .references(() => connectedAccounts.id, { onDelete: 'cascade' }),
    flowRunId: uuid('flow_run_id').references(() => flowRuns.id, { onDelete: 'set null' }),
    direction: messageDirectionEnum('direction').notNull(),
    kind: messageKindEnum('kind').notNull(),
    body: jsonb('body').$type<Record<string, unknown>>().notNull(),
    externalId: text('external_id'),
    commentId: text('comment_id'),
    status: messageStatusEnum('status').notNull(),
    error: text('error'),
    sentAt: tz('sent_at'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('messages_one_private_reply_per_comment')
      .on(t.commentId)
      .where(sql`${t.kind} = 'private_reply'`),
    uniqueIndex('messages_one_comment_reply_per_comment')
      .on(t.commentId)
      .where(sql`${t.kind} = 'comment_reply'`),
    index('messages_contact_created_idx').on(t.contactId, t.createdAt),
    index('messages_status_created_idx').on(t.status, t.createdAt),
  ],
)

// ---------- billing ----------

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    plan: planEnum('plan').notNull().default('free'),
    dodoCustomerId: text('dodo_customer_id'),
    dodoSubscriptionId: text('dodo_subscription_id'),
    status: text('status').notNull().default('active'),
    currentPeriodEnd: tz('current_period_end'),
    ...timestamps,
  },
  (t) => [uniqueIndex('subscriptions_workspace_uq').on(t.workspaceId)],
)

export const usageCounters = pgTable(
  'usage_counters',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    period: text('period').notNull(),
    contactsReached: integer('contacts_reached').notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex('usage_counters_workspace_period_uq').on(t.workspaceId, t.period)],
)
