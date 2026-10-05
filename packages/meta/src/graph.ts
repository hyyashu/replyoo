import { classifyGraphError, MetaError } from './errors'

export const GRAPH_API_VERSION = 'v24.0'
const TIMEOUT_MS = 15_000

export interface GraphRequest {
  baseUrl: string
  path: string
  token: string
  method?: 'GET' | 'POST' | 'DELETE'
  query?: Record<string, string>
  body?: unknown
}

export async function graphRequest<T>(req: GraphRequest): Promise<T> {
  const url = new URL(`${req.baseUrl}/${req.path.replace(/^\//, '')}`)
  for (const [key, value] of Object.entries(req.query ?? {})) url.searchParams.set(key, value)

  const headers: Record<string, string> = { Authorization: `Bearer ${req.token}` }
  if (req.body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(url, {
      method: req.method ?? 'GET',
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (cause) {
    throw new MetaError('retryable', `Graph API request failed: ${(cause as Error).message}`, {
      reason: 'network',
    })
  }

  const text = await response.text()
  let body: unknown = {}
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!response.ok || (body !== null && typeof body === 'object' && 'error' in body)) {
    throw classifyGraphError(response.status, body)
  }
  return body as T
}
