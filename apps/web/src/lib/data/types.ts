import type { FlowDefinition, PlanKey, Platform } from '@replyooo/shared'
import type { Role } from '../workspaces'

export type { Role } from '../workspaces'

export interface ConnectedAccount {
  id: string
  platform: Platform
  username: string
  displayName: string | null
  avatarUrl: string | null
  followers: number | null
  status: 'active' | 'reauth_required' | 'disconnected'
}

export type AutomationStatus = 'draft' | 'active' | 'paused'

export interface AutomationStats {
  runs: number
  completed: number
  dmsSent: number
  leads: number
}

export interface Automation {
  id: string
  accountId: string
  name: string
  status: AutomationStatus
  /** Draft definition (automations.trigger/steps). */
  flow: FlowDefinition
  /** Latest published version, if any. */
  version: number
  /** The draft differs from the published version (always true before the first publish). */
  hasUnpublishedChanges: boolean
  templateKey: string | null
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  stats: AutomationStats
}

export interface ContactMessage {
  direction: 'in' | 'out'
  text: string
  at: string
}

export interface ContactRun {
  automationName: string
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'expired' | 'cancelled'
  at: string
}

export interface Contact {
  id: string
  accountId: string
  username: string
  name: string
  email: string | null
  phone: string | null
  tags: string[]
  fields: Record<string, string>
  avatarUrl: string | null
  /** Null when Instagram hasn't told us yet. */
  followsYou: boolean | null
  youFollow: boolean | null
  firstSeenAt: string
  lastInboundAt: string
}

export interface ContactDetail extends Contact {
  messageCount: number
  messages: ContactMessage[]
  runs: ContactRun[]
}

export interface HomeStats {
  dmsSent: number
  runs: number
  completionRate: number
  leads: number
  liveCount: number
}

export interface Member {
  id: string
  userId: string
  name: string
  email: string
  role: Role
}

export interface Invitation {
  id: string
  email: string
  role: Role
  createdAt: string
}

export interface Subscription {
  /** The plan whose limits apply now (a lapsed paid plan counts as free). */
  plan: PlanKey
  /** The plan on the subscription row, paid or not. */
  billedPlan: PlanKey
  status: string
  /** A Dodo customer exists, so the customer portal can open. */
  hasBillingAccount: boolean
  /** Dodo's next billing date (ISO), when there is one. */
  renewsAt: string | null
  contactsReached: number
  contactsLimit: number
  /** When monthly usage resets: the 1st of next month, UTC (ISO). */
  periodEnd: string
}

export interface ContactFilters {
  q?: string
  tag?: string
  has?: 'email' | 'phone' | 'lead'
  rel?: 'follows_you' | 'mutual'
}

export interface ContactStats {
  total: number
  leads: number
  followsYou: number
  mutual: number
}

export type PublishResult = { ok: true; version: number } | { ok: false; errors: string[] }
export type StatusResult = { ok: true } | { ok: false; error: string }
