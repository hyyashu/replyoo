import 'server-only'
import type { IceBreaker, MetaError } from '@replyooo/meta'
import { encodePostback, type FlowDefinition, type Platform } from '@replyooo/shared'
import { adapterFor, credentialsFor } from '../meta'

/** The questions Meta shows, each pointing back at this automation's item (spec §2.4 ice-breaker postbacks). */
export function iceBreakerItems(automationId: string, flow: FlowDefinition | null): IceBreaker[] {
  if (flow?.trigger.type !== 'ice_breaker') return []
  return flow.trigger.items.map((item, itemIndex) => ({
    question: item.question,
    payload: encodePostback({ kind: 'ice_breaker', automationId, itemIndex }),
  }))
}

/** An empty list clears the account's conversation starters. */
export async function pushIceBreakers(
  account: { platform: Platform; externalId: string; accessTokenEnc: string },
  items: IceBreaker[],
): Promise<void> {
  await adapterFor(account.platform).setIceBreakers(credentialsFor(account), items)
}

export function iceBreakerError(error: MetaError, username: string): string {
  if (error.kind === 'reauth') return `Meta revoked access to @${username}. Reconnect it in Settings, then publish again.`
  return `Meta didn’t accept the conversation starters: ${error.message}`
}
