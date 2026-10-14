# Follow up if no click: Design

Date: 2026-10-14. Status: approved, implemented on branch feat/click-follow-up.

Why this one: link click tracking (2026-10-13) tells us who opened a link, so we can now remind the people who did not. The 2026-10-05 design listed "follow up if no click" as out of scope until click tracking existed. Reachlee has a follow-up nudge; see [../../competitors/reachlee.md](../../competitors/reachlee.md).

## 1. Goal and scope

Add a "Follow up if they don't open the link" option to an automation's final message. A set time after that message is sent, if the person has not opened any of its links, Replyooo sends one follow-up: the owner's text plus the same links again.

**In scope**
- The final message in both formats: text with link buttons, and the product carousel (each card's link counts).
- One follow-up per sent message, 1 to 23 hours later (whole hours, like the existing reminder).
- The follow-up repeats the links: the same link buttons under the follow-up text, or the follow-up text followed by the same carousel. Its links are tracked like any other.
- Every plan, Instagram and Facebook (the carousel is Instagram only already).

**Out of scope**
- More than one follow-up, or a follow-up on messages other than the final one.
- Branching the flow on click ("if clicked, go to step X").
- Separate follow-up analytics beyond what link tracking already shows (see 4).

**Success criteria**
- Someone who does not open the link gets exactly one follow-up at about the chosen time; someone who opens it gets none.
- Nothing is sent outside Meta's 24-hour window, to a disconnected account, or for a paused or deleted automation.
- Retries, worker restarts and a second sweep never send the follow-up twice.
- Opening the link from the follow-up counts in the automation's link stats like any other click.

## 2. How it works

### Flow schema (`@replyooo/shared`)

`send_message` and `send_products` get an optional `clickFollowUp: { afterMinutes, text }`, using the same limits as `NudgeSchema` (afterMinutes 5 to `MAX_NUDGE_MINUTES`, text 1 to 1000 characters).

Validation (`validate.ts`) adds two issues and reuses one:
- `click_follow_up_without_links`: set on a `send_message` with no `url` button.
- `click_follow_up_after_private_reply`: set on the first step of a comment flow. Meta allows one message after a comment until the person replies, so the follow-up could never be sent. Same rule as `nudge_after_private_reply`.
- `buttons_text_too_long`: the follow-up text on a `send_message` is over 640 characters. It is sent above the same link buttons, so Meta's button template limit applies.

### Engine

The engine stays pure and does not wait for clicks. When a step with `clickFollowUp` sends its message, it attaches `followUp: { afterMinutes, text }` to the `OutboundMessage`, with `text` already rendered with the contact's variables. For `send_products` it goes on the carousel message, not the intro. The run carries on and completes as before.

The run does not wait for a click. Holding the run in `waiting` would block `any_dm` automations for that contact for up to 23 hours and make "run on existing comments" skip them (both treat a waiting run as a conversation in progress).

### Data

New table `click_follow_ups` (migration `0011`):

| Column | Notes |
|---|---|
| `id` | uuid |
| `message_id` | the original message, unique, `on delete cascade` |
| `contact_id`, `connected_account_id`, `automation_id`, `flow_run_id` | for the checks below; `set null` on delete where nullable |
| `text` | rendered follow-up text |
| `due_at` | sent-at plus `afterMinutes` |
| `status` | `pending`, `sent`, `skipped` |
| `reason` | why skipped: `clicked`, `window_closed`, `account_inactive`, `automation_inactive`, `in_conversation`, `no_links` |
| `follow_up_message_id` | the new message, once queued |

Index on `(status, due_at)` for the sweep.

### Scheduling (worker)

When `handleOutbound` marks a message `sent` and its body has `followUp`, it inserts the `click_follow_ups` row (`on conflict (message_id) do nothing`, so a retried send cannot schedule twice). Only the message carrying the links schedules it.

The existing 60-second `sweep()` claims due rows (`status = 'pending' and due_at <= now`, `for update skip locked`, in batches) and, for each, in one transaction:

1. **Clicked?** Any `link_clicks` row for a `tracked_links` row of the original message: skip, `clicked`.
2. **Account active?** Otherwise skip, `account_inactive`.
3. **Automation still active?** A paused or deleted automation sends nothing: skip, `automation_inactive`.
4. **Window open?** `contacts.last_inbound_at` within 24 hours: otherwise skip, `window_closed`.
5. **In another conversation?** If the contact has any `waiting` run, skip, `in_conversation`, so a reminder never lands in the middle of a flow. (The original run has already completed, so any waiting run is another conversation.)
6. **Nothing to repeat?** If the stored message has no link buttons or cards, skip, `no_links` (defensive; validation prevents it).
7. Otherwise insert the follow-up `messages` row(s) as `dm`, `queued`, with the original's `flow_run_id`, mark the row `sent` with `follow_up_message_id`, and enqueue `outbound` after commit. A lost enqueue is picked up by the existing stuck-message sweep.

The follow-up body copies the original's untracked links from the stored message body:
- Link message: `{ text, buttons }` with the original `url` buttons (reply buttons dropped; a reply button on the final message would have no step to wait on).
- Carousel: a text message, then the same cards (two rows, sent in order like the step's intro and cards).

`withTrackedLinks` already tracks any `dm` with a `flow_run_id`, so the follow-up's links get their own codes under the same automation. `endRun` only touches `running` or `waiting` runs, so a failed follow-up cannot mark the finished run as failed.

Contact usage is already counted for the month, so the follow-up does not add to the plan's contact count.

### Editor (web)

The recipe gets an optional `clickFollowUp: { enabled, afterHours, text }` (unset means off, so existing recipes and templates need no change), compiled onto the final message step and read back from it. The Extras section gets a switch "Follow up if they don't open the link" under "Remind them once", with the same text and hours fields; it is disabled, with a short note, when the final message has no link buttons or cards. In the recipe a comment flow always starts with the opener, so the final message is never the one-shot private reply. Follow-up validation issues show under Extras. English and Spanish catalog entries. The phone preview does not show the follow-up, like the reminder.

## 3. Edge cases

- **Bot or link-scanner prefetch.** A prefetch that link tracking counts as a click also cancels the follow-up. The open phone test in the launch plan checks for this.
- **They reply but don't click.** Their message reopens the window, so the follow-up can go out. Fine: they have not opened the link.
- **They click after the follow-up was queued but before it sent.** Rare (sweep and send are seconds apart); accepted.
- **Automation edited after the send.** The follow-up uses the text rendered at send time and the links from the sent message, not the current version.
- **Clicked on an older message from the same automation.** Only this message's links count; earlier runs are separate.

## 4. Visibility

No new dashboard section in this part. Follow-up messages appear in the contact's message history, and their clicks count toward the automation's clickers. Link stats count distinct contacts, so a follow-up does not inflate the recipient count. The `click_follow_ups` table keeps sent and skipped counts for a later "Follow-ups sent" figure.

## 5. Testing

- Shared: schema limits and both validation issues.
- Engine: `followUp` attached to the right message for both formats, text rendered, absent when unset.
- Worker (Postgres container, existing harness): scheduled once on send and not on retry; skipped for each reason; sent once when not clicked; two sweeps send once; follow-up links tracked; a failed follow-up leaves the completed run alone.
- Web: recipe compiles and reads back `clickFollowUp` for both formats; the three validation messages map to translated errors.
- Browser check on the seeded demo account (done 2026-10-15): switch, text and hours fields, 0 issues on a comment flow, autosave on and off, setting survives a reload, Spanish text.
- Not testable locally: a real follow-up on a phone. Added to the launch plan's live tests.
