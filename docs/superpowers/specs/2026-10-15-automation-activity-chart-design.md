# Automation activity chart: Design

Date: 2026-10-15. Status: built, merged to `main`, not yet deployed.

Why this one: Reachlee shows click trends per automation; we only had 30-day totals and a 14-day chart per link. The data already existed, so this is a small change that also makes click tracking and click follow-ups visible in a demo. See [../../competitors/reachlee.md](../../competitors/reachlee.md).

## 1. Scope

**In scope**
- An "Activity · last 30 days" section on a published automation's page, above "Link clicks".
- Three tiles with 30-day totals: Conversations (runs started), DMs sent (sent `dm` and `private_reply` messages), Link clicks (taps on the automation's tracked links). The selected tile drives one bar chart, a bar per day, with the date and count on hover.
- A follow-ups line once the automation has any: sent, opened the link after it, and not needed because the link was already opened.
- English and Spanish.

**Out of scope**
- Lifetime or custom date ranges, time zones other than UTC, exports.
- Leads per day (contacts have no "captured at" time).
- A home dashboard chart.

## 2. How it works

**Queries (`@replyooo/db`)**
- `automationDaily(db, automationId, days = 30)`: one row per UTC day, oldest first, zeros included (`generate_series` left-joined to per-day counts of runs, sent DMs and clicks). Same UTC days as `automationLinkDaily`.
- `automationFollowUpStats(db, automationId, since)`: from `click_follow_ups` scheduled since `since`. `sent` counts follow-ups whose message was actually sent; `opened` counts those whose follow-up message's tracked links got a click (for a carousel, `follow_up_message_id` is the cards message, which carries the links); `skippedClicked` counts rows skipped with reason `clicked`.
- Migration `0012` adds `flow_runs (automation_id, created_at)`, used by this chart and the existing 30-day stats.

**Web**
- `automationActivity(workspaceId, id)` in `lib/data/automations.ts` checks the automation belongs to the workspace, then runs both queries. Server action `getAutomationActivity`.
- `activity.tsx` loads on mount, like `LinkInsights`. It is shown when the automation is not a draft and has runs in the last 30 days. The chart has `role="img"` with a label naming the series; tiles are toggle buttons with `aria-pressed`.

## 3. Testing

- Database (Postgres container): 30 days, oldest first, ending today; counts land on the right day; public comment replies, failed messages and runs older than 30 days are excluded; follow-up stats for sent, opened, failed, skipped-clicked, other skips and pending.
- Browser check on the seeded demo account (2026-10-15): totals and bars match the 8 runs and 8 DMs; switching tiles changes the chart and its label. The follow-ups line is covered by tests only (no follow-ups in the demo data).
