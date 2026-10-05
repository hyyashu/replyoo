import type { FlowDefinition } from '../flow'
import type { Platform } from '../platform'

export type TemplateCategory =
  | 'recommended'
  | 'sell_products'
  | 'setup_inbox'
  | 'grow_followers'
  | 'engage_audience'
  | 'collect_leads'

export interface FlowTemplate {
  key: string
  title: string
  description: string
  categories: TemplateCategory[]
  platforms: Platform[]
  isNew?: boolean
  flow: FlowDefinition
}
