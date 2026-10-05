export type PostbackPayload =
  | { kind: 'run'; runId: string; stepId: string; buttonId: string }
  | { kind: 'ice_breaker'; automationId: string; itemIndex: number }

export function encodePostback(payload: PostbackPayload): string {
  return payload.kind === 'run'
    ? `r:${payload.runId}:${payload.stepId}:${payload.buttonId}`
    : `ib:${payload.automationId}:${payload.itemIndex}`
}

export function decodePostback(raw: string): PostbackPayload | null {
  const parts = raw.split(':')
  if (parts[0] === 'r' && parts.length === 4) {
    const [, runId, stepId, buttonId] = parts
    if (runId && stepId && buttonId) return { kind: 'run', runId, stepId, buttonId }
    return null
  }
  if (parts[0] === 'ib' && parts.length === 3) {
    const [, automationId, index] = parts
    const itemIndex = Number(index)
    if (automationId && index && /^\d+$/.test(index)) return { kind: 'ice_breaker', automationId, itemIndex }
  }
  return null
}
