import { DmLinkTool } from '@/components/tools/dm-link-tool'
import { DmReplyTool } from '@/components/tools/dm-reply-tool'
import { EngagementTool } from '@/components/tools/engagement-tool'
import { TextLimitsTool } from '@/components/tools/text-limits-tool'
import { UtmTool } from '@/components/tools/utm-tool'
import type { ToolKey } from '@/lib/content/types'

/** The interactive part of each /tools page, picked by the page's `tool` key. */
export const TOOLS: Record<ToolKey, () => React.ReactNode> = {
  'dm-link': DmLinkTool,
  'dm-replies': DmReplyTool,
  utm: UtmTool,
  engagement: EngagementTool,
  'text-limits': TextLimitsTool,
}
