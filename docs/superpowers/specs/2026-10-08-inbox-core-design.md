# Inbox, part 1: core (read and reply)

Date: 2026-10-08. Status: drafted, build deferred until after launch.

## Where this fits

The inbox is split into three parts, each with its own spec, plan and build. The user asked for everything Reachlee's inbox has (their "C"), delivered one part at a time:

1. **Core (this spec):** conversation list, chat view, manual DM replies, unread, archive, search, live refresh.
2. **Workflow tools:** labels, private notes, contact details panel, saved replies (`/`).
3. **Advanced:** scheduled sends, image attachments, the Outreach tab (DMs sent by hand in the Instagram app), sound alert.

Out of scope for all three: Reachlee's "AI" filter chip. The spec's "Out of scope for v1" line about a live inbox is superseded by this work.

## Goal

A screen where the account owner reads every conversation, including the automated DMs, and answers by hand. Replies go through the existing worker send path, so the 24-hour DM window, per-account rate limit and usage counting still apply.

## What exists today

- `messages` stores every in and out message per contact (kinds: `dm`, `private_reply`, `comment_reply`, `comment`, `postback`; statuses `queued`, `sent`, `failed`, `received`). Index `messages_contact_created_idx`.
- `contacts.lastInboundAt` drives the 24-hour window. `apps/worker/src/outbound.ts` fails a `dm` outside it with `window_closed`.
- The worker's `outbound` queue sends `messageIds` in order. `sweep()` re-enqueues rows stuck in `queued` after 5 minutes.
- The web app has no queue client and no Redis setting.

## Design

### Data

Two nullable columns on `contacts`, one migration (`0007_inbox_state.sql`):

- `inbox_read_at timestamptz`: when the owner last opened the thread.
- `inbox_archived_at timestamptz`: when the owner archived it.

Derived state, no worker changes:

- **Unread:** `last_inbound_at` is not null and (`inbox_read_at` is null or `inbox_read_at < last_inbound_at`).
- **Archived:** `inbox_archived_at` is not null and `inbox_archived_at >= last_inbound_at` (or there is no inbound). A new inbound message therefore brings the thread back to Chats by itself.

A thread is a contact that has at least one message. A manual reply is a `messages` row with `direction = 'out'`, `kind = 'dm'`, `flow_run_id` null. No new message column.

### Sending (web to worker)

The web app gets a small queue client and enqueues onto the same `outbound` queue the worker consumes.

1. The server action `sendInboxMessage(contactId, text)` loads the contact scoped to the user's workspace, trims the text, rejects empty text and text over 1000 characters, and rejects when `lastInboundAt` is more than 24 hours ago (`window_closed`).
2. It inserts the `messages` row (`dm`, `queued`, body `{ type: 'message', message: { text } }`) and enqueues `{ messageIds: [id] }`.
3. If enqueueing fails, the row stays `queued` and `sweep()` picks it up within 5 minutes. The action still returns success, and the bubble shows "Sending…".
4. The worker sends it unchanged. A failure shows on the bubble as "Failed: <reason>" with a Retry button that creates a new message.

New web setting: `REDIS_URL` (the same Redis the worker uses and the same queue prefix, if any). `docker-compose.prod.yml` and `deploy/.env.example` pass it to the `web` service. The worker already refuses a non-active account, so the web action also disables the composer for accounts that need reconnecting.

### Reading

Data layer in `apps/web/src/lib/data/inbox.ts`, always scoped by workspace:

- `listThreads({ workspaceId, accountId?, filter: 'all' | 'unread' | 'archived', search?, limit = 50 })`: one row per contact with messages, ordered by latest message time, newest first. Fields: contact id, name, username, avatar, last message preview (text of the latest message, or a label such as "Commented: …" or "Tapped: …"), last message time, unread flag, archived flag, whether the 24-hour window is still open. Search matches name and username, case-insensitive.
- `getThread(workspaceId, contactId, { before?, limit = 100 })`: the contact plus messages in time order. Older messages load on request (`before`).
- `markThreadRead(workspaceId, contactId)`, `setThreadArchived(workspaceId, contactId, archived)`.
- `unreadThreadCount(workspaceId)` for the sidebar badge.

### UI

Route `/inbox` (added to the auth matcher in `proxy.ts` and to the sidebar between Contacts and Settings, with an unread badge). Selection lives in the URL (`/inbox?c=<contactId>`), so a thread can be linked and reloaded. Two panes, like Reachlee:

- **Left:** tabs Chats and Archived (Outreach arrives in part 3), search box, filter chips All and Unread, and the thread rows.
- **Right:** header (avatar, name, `@username`, an Archive / Unarchive button), the message list (incoming left, outgoing right; comments, postbacks and public replies shown as small labelled bubbles; timestamps; failed state), and the composer.
- **Composer:** text box, Send button, Enter to send and Shift+Enter for a new line. When the window is closed the box is disabled with "The 24-hour reply window has closed. You can reply again when they message you." The emoji button is included (a plain picker, no attachments in this part).
- **Live refresh:** a client component polls two JSON route handlers every 5 seconds while the tab is visible and pauses when hidden. One returns the thread list and unread count; the other returns messages newer than the last seen one for the open thread. Opening a thread calls `markThreadRead`. The list keeps the user's scroll position, and the chat scrolls to the bottom only when the user is already near it.
- Layout works at phone width: list and chat become two screens with a back button.

### Errors and edge cases

- A contact from another workspace, or a missing id, returns not found. No data leaks across workspaces.
- Double click on Send creates one message (the button disables while the action runs).
- A message that was `queued` and then fails shows the worker's reason (`window_closed`, `account_inactive`, rate limit text).
- Deleted or blocked contacts: the thread stays readable and the send error is shown as is.

### Testing

- Data layer (Vitest with the Postgres container): list ordering, unread and archived derivation including auto-unarchive on a new inbound, search, workspace isolation, `before` paging, unread count.
- `sendInboxMessage`: window check, empty and over-long text, workspace scoping, row creation and enqueue (queue stubbed).
- Worker: a manual `dm` (no `flow_run_id`) is sent and marked `sent`, and fails with `window_closed` outside the window, using the existing worker test harness.
- Browser check on the local seeded demo account: open a thread, send inside the window, composer disabled outside it, unread badge clears, archive and unarchive, search, polling picks up a new row inserted by hand.
- Not testable locally: a real Instagram send. That is verified on the deployed app.

## Out of scope for part 1

Labels, notes, saved replies, details panel (part 2); scheduling, attachments, Outreach tab, sound (part 3); typing indicators and read receipts from Instagram; multi-user assignment.
