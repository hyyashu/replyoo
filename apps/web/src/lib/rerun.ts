/** Look-back options for "run on existing comments", in hours. Matches `BACKFILL_WINDOWS_HOURS` in the database package. */
export const RERUN_WINDOWS = [24, 72, 168] as const

const KNOWN_FAILURES = ['token_invalid', 'network', 'timed_out', 'account_inactive', 'automation_not_active', 'not_a_comment_automation'] as const

/** The catalog key for why a run failed. Reasons are codes from the worker, so unknown ones get a generic message. */
export function rerunFailureKey(reason: string | null): `rerun_failure_${(typeof KNOWN_FAILURES)[number] | 'unknown'}` {
  const known = KNOWN_FAILURES.find((r) => r === reason)
  return `rerun_failure_${known ?? 'unknown'}`
}
