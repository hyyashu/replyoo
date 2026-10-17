import { BACKFILL_WINDOWS_HOURS } from '@replyooo/shared'

/** Look-back options for "run on existing comments", in hours. */
export const RERUN_WINDOWS = BACKFILL_WINDOWS_HOURS

const KNOWN_FAILURES = ['token_invalid', 'network', 'timed_out', 'account_inactive', 'automation_not_active', 'not_a_comment_automation'] as const

/** The catalog key for why a run failed. Reasons are codes from the worker, so unknown ones get a generic message. */
export function rerunFailureKey(reason: string | null): `rerun_failure_${(typeof KNOWN_FAILURES)[number] | 'unknown'}` {
  const known = KNOWN_FAILURES.find((r) => r === reason)
  return `rerun_failure_${known ?? 'unknown'}`
}
