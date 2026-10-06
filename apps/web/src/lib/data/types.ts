import type { FlowDefinition, Platform } from '@replyooo/shared'

export interface ConnectedAccount {
  id: string
  platform: Platform
  username: string
  displayName: string | null
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
  templateKey: string | null
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
  firstSeenAt: string
  lastInboundAt: string
}

export interface ContactDetail extends Contact {
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
  name: string
  email: string
  role: 'owner' | 'admin' | 'member'
}

export interface Subscription {
  plan: 'free' | 'pro' | 'business'
  contactsReached: number
  contactsLimit: number
  periodEnd: string
}

export interface Workspace {
  id: string
  name: string
  user: { name: string; email: string }
}

export interface ContactFilters {
  q?: string
  tag?: string
  has?: 'email' | 'phone'
}

export type PublishResult = { ok: true; version: number } | { ok: false; errors: string[] }
export type StatusResult = { ok: true } | { ok: false; error: string }
