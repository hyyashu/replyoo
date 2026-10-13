import { automations, automationVersions, BACKFILL_WINDOWS_HOURS, backfillRuns, connectedAccounts, flowRuns } from '@replyooo/db'
import type { FlowDefinition } from '@replyooo/shared'
import { eq } from 'drizzle-orm'
import { http, HttpResponse } from 'msw'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import * as data from '@/lib/data'
import { db } from '@/lib/db'
import { RERUN_WINDOWS, rerunFailureKey } from '@/lib/rerun'
import { createAccount, createContact, createWorkspace, mockFetch, one } from './support'

const server = mockFetch()
beforeEach(() => server.reset())
afterAll(() => server.restore())

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString().replace('Z', '+0000')

const flow = (posts: { mode: 'any' } | { mode: 'next' } | { mode: 'specific'; mediaIds: string[] }): FlowDefinition => ({
  trigger: { type: 'comment_keyword', posts, keywords: ['guide'], match: 'contains' },
  start: 's1',
  steps: { s1: { type: 'send_message', text: 'Here you go' } },
})

async function setup(opts: { posts?: Parameters<typeof flow>[0]; status?: 'active' | 'paused'; pinned?: string | null } = {}) {
  const { workspaceId } = await createWorkspace()
  const account = await createAccount(workspaceId)
  const definition = flow(opts.posts ?? { mode: 'specific', mediaIds: ['m1'] })
  const automation = one(
    await db()
      .insert(automations)
      .values({
        workspaceId,
        connectedAccountId: account.id,
        name: 'Guide',
        status: opts.status ?? 'active',
        triggerType: 'comment_keyword',
        definition,
        pinnedMediaId: opts.pinned ?? null,
      })
      .returning(),
  )
  const version = one(
    await db().insert(automationVersions).values({ automationId: automation.id, version: 1, definition, publishedAt: new Date() }).returning(),
  )
  await db().update(automations).set({ currentVersionId: version.id }).where(eq(automations.id, automation.id))
  return { workspaceId, account, automation, version }
}

function comments(mediaId: string, items: { id: string; text: string; hoursAgo: number; from?: string | null }[]) {
  server.use(
    http.get(`https://graph.instagram.com/v24.0/${mediaId}/comments`, () =>
      HttpResponse.json({
        data: items.map((c) => ({
          id: c.id,
          text: c.text,
          timestamp: hoursAgo(c.hoursAgo),
          ...(c.from === null ? {} : { from: { id: c.from ?? `u_${c.id}`, username: 'someone' } }),
        })),
      }),
    ),
  )
}

describe('rerun windows', () => {
  it('match what the database accepts', () => {
    expect([...RERUN_WINDOWS]).toEqual([...BACKFILL_WINDOWS_HOURS])
  })
})

describe('rerunFailureKey', () => {
  it('maps the reasons a run can fail with to their own messages', () => {
    for (const reason of ['token_invalid', 'network', 'timed_out', 'account_inactive', 'automation_not_active', 'not_a_comment_automation']) {
      expect(rerunFailureKey(reason)).toBe(`rerun_failure_${reason}`)
    }
  })

  it('falls back to a generic message for anything else, including a missing reason', () => {
    expect(rerunFailureKey('some_future_reason')).toBe('rerun_failure_unknown')
    expect(rerunFailureKey('unexpected_error')).toBe('rerun_failure_unknown')
    expect(rerunFailureKey(null)).toBe('rerun_failure_unknown')
  })
})

describe('previewRerun', () => {
  it('counts comments found, handled, not matching and eligible', async () => {
    const s = await setup()
    const contact = await createContact(s.workspaceId, s.account.id)
    await db().insert(flowRuns).values({
      automationId: s.automation.id,
      automationVersionId: s.version.id,
      contactId: contact.id,
      connectedAccountId: s.account.id,
      commentId: 'c_done',
    })
    comments('m1', [
      { id: 'c_ok', text: 'guide please', hoursAgo: 2 },
      { id: 'c_done', text: 'guide', hoursAgo: 3 },
      { id: 'c_no', text: 'love it', hoursAgo: 4 },
      { id: 'c_old', text: 'guide', hoursAgo: 100 },
      { id: 'c_anon', text: 'guide', hoursAgo: 5, from: null },
    ])
    const result = await data.previewRerun(s.workspaceId, s.automation.id, 72)
    expect(result).toEqual({ ok: true, preview: { found: 3, handled: 1, noMatch: 1, eligible: 1, capped: false } })
  })

  it('refuses a window that is not offered, and unknown or foreign automations', async () => {
    const s = await setup()
    const other = await createWorkspace('Other')
    expect(await data.previewRerun(s.workspaceId, s.automation.id, 999)).toMatchObject({ ok: false, code: 'bad_window' })
    expect(await data.previewRerun(other.workspaceId, s.automation.id, 72)).toMatchObject({ ok: false, code: 'not_found' })
    expect(await data.previewRerun(s.workspaceId, 'not-a-uuid', 72)).toMatchObject({ ok: false, code: 'not_found' })
    expect(await data.previewRerun(s.workspaceId, randomUUID(), 72)).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('explains why it cannot run: paused, next-post not yet picked, account needs reauth, not a comment automation', async () => {
    const paused = await setup({ status: 'paused' })
    expect(await data.previewRerun(paused.workspaceId, paused.automation.id, 72)).toMatchObject({ ok: false, code: 'not_active' })

    const next = await setup({ posts: { mode: 'next' } })
    expect(await data.previewRerun(next.workspaceId, next.automation.id, 72)).toMatchObject({ ok: false, code: 'no_post_yet' })

    const reauth = await setup()
    await db().update(connectedAccounts).set({ status: 'reauth_required' }).where(eq(connectedAccounts.id, reauth.account.id))
    expect(await data.previewRerun(reauth.workspaceId, reauth.automation.id, 72)).toMatchObject({ ok: false, code: 'account_inactive' })

    const dm = await setup()
    const dmFlow: FlowDefinition = { trigger: { type: 'any_dm' }, start: 's1', steps: { s1: { type: 'send_message', text: 'hi' } } }
    await db().update(automationVersions).set({ definition: dmFlow }).where(eq(automationVersions.id, dm.version.id))
    expect(await data.previewRerun(dm.workspaceId, dm.automation.id, 72)).toMatchObject({ ok: false, code: 'not_comment_automation' })
  })

  it('turns a revoked token into a reauth error', async () => {
    const s = await setup()
    server.use(
      http.get('https://graph.instagram.com/v24.0/m1/comments', () =>
        HttpResponse.json({ error: { message: 'Invalid OAuth access token', type: 'OAuthException', code: 190 } }, { status: 400 }),
      ),
    )
    expect(await data.previewRerun(s.workspaceId, s.automation.id, 72)).toMatchObject({ ok: false, code: 'reauth' })
  })
})

describe('startRerun and latestRerun', () => {
  it('queues a run, returns the same run on a second click, and exposes the latest', async () => {
    const s = await setup()
    expect(await data.latestRerun(s.workspaceId, s.automation.id)).toBeNull()
    const first = await data.startRerun(s.workspaceId, s.automation.id, 72)
    expect(first).toMatchObject({ ok: true, run: { status: 'queued', windowHours: 72 } })
    const second = await data.startRerun(s.workspaceId, s.automation.id, 24)
    expect(second.ok && first.ok && second.run.id === first.run.id).toBe(true)
    const rows = await db().select().from(backfillRuns).where(eq(backfillRuns.automationId, s.automation.id))
    expect(rows).toHaveLength(1)
    expect(await data.latestRerun(s.workspaceId, s.automation.id)).toMatchObject({ id: rows[0]!.id, status: 'queued' })
  })

  it('applies the same checks as the preview', async () => {
    const s = await setup({ status: 'paused' })
    expect(await data.startRerun(s.workspaceId, s.automation.id, 72)).toMatchObject({ ok: false, code: 'not_active' })
    expect(await data.startRerun(s.workspaceId, s.automation.id, 5)).toMatchObject({ ok: false, code: 'bad_window' })
  })

  it('does not show another workspace’s run', async () => {
    const s = await setup()
    const other = await createWorkspace('Other')
    await data.startRerun(s.workspaceId, s.automation.id, 72)
    expect(await data.latestRerun(other.workspaceId, s.automation.id)).toBeNull()
  })
})
