import { automationVersions, automations } from '@replyooo/db'
import { TEMPLATES, type FlowDefinition } from '@replyooo/shared'
import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as data from '@/lib/data/automations'
import { db } from '@/lib/db'
import { DEFAULT_RECIPE, compileRecipe } from '@/lib/recipe'
import { createAccount, createContact, createMessage, createRun, createWorkspace } from './support'

async function setup(platform: 'instagram' | 'facebook' = 'instagram') {
  const { workspaceId } = await createWorkspace()
  const account = await createAccount(workspaceId, platform)
  return { workspaceId, accountId: account.id }
}

async function created(workspaceId: string, accountId: string, templateKey: string | null) {
  const automation = await data.createAutomation(workspaceId, accountId, templateKey)
  if (!automation) throw new Error('createAutomation returned null')
  return automation
}

// Conversation starters call Meta on publish; they're covered with msw in ice-breakers.test.ts.
const LOCAL_TEMPLATES = TEMPLATES.filter((t) => t.flow.trigger.type !== 'ice_breaker')

describe('publishAutomation', () => {
  it.each(LOCAL_TEMPLATES.map((t) => [t.key] as const))('publishes a fresh %s draft on Instagram', async (key) => {
    const { workspaceId, accountId } = await setup()
    const automation = await created(workspaceId, accountId, key)
    expect(await data.publishAutomation(workspaceId, automation.id)).toEqual({ ok: true, version: 1 })
    expect(await data.getAutomation(workspaceId, automation.id)).toMatchObject({ status: 'active', version: 1 })
    const [version] = await db().select().from(automationVersions).where(eq(automationVersions.automationId, automation.id))
    expect(version?.definition).toEqual(automation.flow)
  })

  it('creates a new immutable version on every publish', async () => {
    const { workspaceId, accountId } = await setup()
    const automation = await created(workspaceId, accountId, 'comment_to_dm')
    await data.publishAutomation(workspaceId, automation.id)

    const edited = structuredClone(automation.flow)
    if (edited.trigger.type === 'comment_keyword') edited.trigger.keywords = ['CHANGED']
    expect(await data.saveDraft(workspaceId, automation.id, { name: 'Renamed', flow: edited })).toBe(true)
    expect(await data.publishAutomation(workspaceId, automation.id)).toEqual({ ok: true, version: 2 })

    const versions = await db()
      .select()
      .from(automationVersions)
      .where(eq(automationVersions.automationId, automation.id))
      .orderBy(asc(automationVersions.version))
    expect(versions.map((v) => v.version)).toEqual([1, 2])
    expect(versions[0]?.definition).toEqual(automation.flow)
    expect(versions[1]?.definition).toEqual(edited)
    const [row] = await db().select().from(automations).where(eq(automations.id, automation.id))
    expect(row?.currentVersionId).toBe(versions[1]?.id)
    expect(row?.name).toBe('Renamed')
  })

  it('rejects a follow gate on a Facebook Page and leaves the draft unpublished', async () => {
    const { workspaceId, accountId } = await setup('facebook')
    const automation = await created(workspaceId, accountId, null)
    await data.saveDraft(workspaceId, automation.id, {
      name: 'Gate',
      flow: compileRecipe({ ...DEFAULT_RECIPE, followGate: { ...DEFAULT_RECIPE.followGate, enabled: true } }),
    })
    expect(await data.publishAutomation(workspaceId, automation.id)).toEqual({
      ok: false,
      errors: ['Follow checks are only available on Instagram'],
    })
    expect(await data.getAutomation(workspaceId, automation.id)).toMatchObject({ status: 'draft', version: 0 })
  })

  it('rejects a comment flow whose first message has no reply button', async () => {
    const { workspaceId, accountId } = await setup()
    const automation = await created(workspaceId, accountId, 'comment_to_dm')
    const flow = structuredClone(automation.flow)
    flow.start = 'link'
    delete flow.steps.opener
    await data.saveDraft(workspaceId, automation.id, { name: 'Broken', flow })
    expect((await data.publishAutomation(workspaceId, automation.id)).ok).toBe(false)
  })
})

describe('"next post" pinning', () => {
  const nextPost = (): FlowDefinition => {
    const flow = compileRecipe(DEFAULT_RECIPE)
    if (flow.trigger.type === 'comment_keyword') flow.trigger.posts = { mode: 'next' }
    return flow
  }

  it('keeps the pinned post when a "next post" automation is republished, and drops it otherwise', async () => {
    const { workspaceId, accountId } = await setup()
    const automation = await created(workspaceId, accountId, null)
    await data.saveDraft(workspaceId, automation.id, { name: 'Next', flow: nextPost() })
    await data.publishAutomation(workspaceId, automation.id)
    await db().update(automations).set({ pinnedMediaId: 'media_1' }).where(eq(automations.id, automation.id))

    await data.publishAutomation(workspaceId, automation.id)
    let [row] = await db().select().from(automations).where(eq(automations.id, automation.id))
    expect(row?.pinnedMediaId).toBe('media_1')

    await data.saveDraft(workspaceId, automation.id, { name: 'Any', flow: compileRecipe(DEFAULT_RECIPE) })
    await data.publishAutomation(workspaceId, automation.id)
    ;[row] = await db().select().from(automations).where(eq(automations.id, automation.id))
    expect(row?.pinnedMediaId).toBeNull()
  })

  it('only keeps a pin between two "next post" versions', () => {
    expect(data.keepsPinnedPost(nextPost(), nextPost())).toBe(true)
    expect(data.keepsPinnedPost(null, nextPost())).toBe(false)
    expect(data.keepsPinnedPost(compileRecipe(DEFAULT_RECIPE), nextPost())).toBe(false)
  })
})

describe('workspace isolation', () => {
  it('treats another workspace’s automation as missing', async () => {
    const a = await setup()
    const b = await setup()
    const automation = await created(a.workspaceId, a.accountId, 'comment_to_dm')

    expect(await data.getAutomation(b.workspaceId, automation.id)).toBeNull()
    expect(await data.saveDraft(b.workspaceId, automation.id, { name: 'Hijacked', flow: automation.flow })).toBe(false)
    expect(await data.publishAutomation(b.workspaceId, automation.id)).toEqual({ ok: false, errors: ['Automation not found'] })
    expect(await data.setAutomationStatus(b.workspaceId, automation.id, 'paused')).toEqual({
      ok: false,
      error: 'Automation not found',
    })
    await data.deleteAutomation(b.workspaceId, automation.id)
    expect(await data.listAutomations(b.workspaceId, a.accountId)).toEqual([])

    expect(await data.getAutomation(a.workspaceId, automation.id)).toMatchObject({ name: automation.name, status: 'draft' })
  })

  it('won’t create an automation on another workspace’s account', async () => {
    const a = await setup()
    const b = await setup()
    expect(await data.createAutomation(b.workspaceId, a.accountId, null)).toBeNull()
  })

  it('returns not found for malformed ids instead of throwing', async () => {
    const { workspaceId, accountId } = await setup()
    expect(await data.getAutomation(workspaceId, 'aut_breakfast')).toBeNull()
    expect(await data.saveDraft(workspaceId, 'aut_breakfast', { name: 'x', flow: compileRecipe(DEFAULT_RECIPE) })).toBe(false)
    expect(await data.publishAutomation(workspaceId, 'aut_breakfast')).toEqual({ ok: false, errors: ['Automation not found'] })
    expect(await data.setAutomationStatus(workspaceId, 'aut_breakfast', 'paused')).toEqual({ ok: false, error: 'Automation not found' })
    expect(await data.createAutomation(workspaceId, 'acc_ig', null)).toBeNull()
    expect(await data.listAutomations(workspaceId, 'acc_ig')).toEqual([])
    await expect(data.deleteAutomation(workspaceId, 'aut_breakfast')).resolves.toBeUndefined()
    expect(await data.listAutomations(workspaceId, accountId)).toEqual([])
  })
})

describe('setAutomationStatus', () => {
  it('cannot turn on an automation that was never published', async () => {
    const { workspaceId, accountId } = await setup()
    const automation = await created(workspaceId, accountId, null)
    expect(await data.setAutomationStatus(workspaceId, automation.id, 'active')).toEqual({
      ok: false,
      error: 'Publish this automation first',
    })
    expect((await data.getAutomation(workspaceId, automation.id))?.status).toBe('draft')
  })

  it('pauses and resumes a published automation', async () => {
    const { workspaceId, accountId } = await setup()
    const automation = await created(workspaceId, accountId, 'dm_keyword')
    await data.publishAutomation(workspaceId, automation.id)
    expect(await data.setAutomationStatus(workspaceId, automation.id, 'paused')).toEqual({ ok: true })
    expect((await data.getAutomation(workspaceId, automation.id))?.status).toBe('paused')
    expect(await data.setAutomationStatus(workspaceId, automation.id, 'active')).toEqual({ ok: true })
    expect((await data.getAutomation(workspaceId, automation.id))?.status).toBe('active')
  })
})

describe('listAutomations', () => {
  it('counts runs, completions, DMs sent and leads from the last 30 days', async () => {
    const { workspaceId, accountId } = await setup()
    const automation = await created(workspaceId, accountId, 'comment_to_dm')
    await data.publishAutomation(workspaceId, automation.id)
    const lead = await createContact(workspaceId, accountId, { email: 'lead@example.com' })
    const other = await createContact(workspaceId, accountId)

    const run = await createRun({ automationId: automation.id, contactId: lead.id, accountId, status: 'completed' })
    await createRun({ automationId: automation.id, contactId: other.id, accountId, status: 'failed' })
    await createRun({
      automationId: automation.id,
      contactId: other.id,
      accountId,
      status: 'completed',
      createdAt: new Date(Date.now() - 40 * 86_400_000),
    })
    await createMessage({ contactId: lead.id, accountId, runId: run.id, kind: 'private_reply' })
    await createMessage({ contactId: lead.id, accountId, runId: run.id, kind: 'dm' })
    await createMessage({ contactId: lead.id, accountId, runId: run.id, kind: 'dm', status: 'failed' })
    await createMessage({ contactId: lead.id, accountId, runId: run.id, kind: 'comment_reply', body: { type: 'comment', text: 'Sent!' } })

    const [listed] = await data.listAutomations(workspaceId, accountId)
    expect(listed?.stats).toEqual({ runs: 2, completed: 1, dmsSent: 2, leads: 1 })
  })

  it('lists live automations before paused ones and drafts', async () => {
    const { workspaceId, accountId } = await setup()
    const draft = await created(workspaceId, accountId, null)
    const live = await created(workspaceId, accountId, 'dm_keyword')
    await data.publishAutomation(workspaceId, live.id)
    expect((await data.listAutomations(workspaceId, accountId)).map((a) => a.id)).toEqual([live.id, draft.id])
  })
})
