/**
 * Local demo data so the dashboard has something to show without a real Meta account.
 * Login: demo@replyooo.dev / replyooo-demo. Safe to re-run (it stops if the user exists).
 *
 *   pnpm --filter @replyooo/web db:seed
 */
import { authUsers, automations, connectedAccounts, contacts, encryptToken, flowRuns, messages, usageCounters } from '@replyooo/db'
import { usagePeriod } from '@replyooo/shared'
import { eq } from 'drizzle-orm'
import { createAuth } from '../src/lib/auth'
import { createAutomation, publishAutomation } from '../src/lib/data/automations'
import { closeDb, db } from '../src/lib/db'
import { env } from '../src/lib/env'
import { tokenKey } from '../src/lib/meta'
import { resolveWorkspace } from '../src/lib/workspaces'

const EMAIL = 'demo@replyooo.dev'
const PASSWORD = 'replyooo-demo'
const TEMPLATES = ['email_list', 'comment_to_dm', 'follow_gate'] as const
const PEOPLE = [
  'sam.eats', 'priya.cooks', 'jules.bakes', 'noor.lifts', 'tomas.runs', 'aiko.plants', 'ben.brews', 'lena.reads',
  'omar.travels', 'zoe.knits', 'ravi.codes', 'mia.paints', 'leo.surfs', 'ines.sings', 'kai.climbs', 'ada.builds',
  'max.grills', 'eva.dances', 'raj.shoots', 'ivy.writes', 'tom.fixes', 'nia.teaches', 'yuki.draws', 'cal.rides',
]
const STATUSES = ['completed', 'completed', 'completed', 'waiting', 'failed'] as const
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000)

/** The demo login is public, so never seed anything but a local database. */
function assertLocalTarget() {
  const host = new URL(env().DATABASE_URL).hostname
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)
  if (process.env.NODE_ENV === 'production' || (!local && process.env.ALLOW_SEED !== '1')) {
    throw new Error(`Refusing to seed ${host} (NODE_ENV=${process.env.NODE_ENV ?? 'unset'}). Local databases only; set ALLOW_SEED=1 to override a non-local host.`)
  }
}

async function main() {
  assertLocalTarget()
  const [existing] = await db().select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.email, EMAIL))
  if (existing) {
    console.log(`${EMAIL} already exists, nothing to do.`)
    return
  }

  const auth = createAuth({ db: db(), secret: env().BETTER_AUTH_SECRET, baseURL: env().APP_URL })
  const { user } = await auth.api.signUpEmail({ body: { name: 'Maya Lopez', email: EMAIL, password: PASSWORD } })
  const { workspaceId } = await resolveWorkspace(db(), { ...user, emailVerified: false })

  const [account] = await db()
    .insert(connectedAccounts)
    .values({
      workspaceId,
      platform: 'instagram',
      externalId: `demo_${user.id}`,
      username: 'maya.makes',
      displayName: 'Maya Makes',
      followersCount: 412_000,
      accessTokenEnc: encryptToken('demo-token-not-valid-for-meta', tokenKey()),
      connectedByUserId: user.id,
    })
    .returning()
  if (!account) throw new Error('account insert failed')

  const live: { id: string; versionId: string }[] = []
  for (const key of TEMPLATES) {
    const automation = await createAutomation(workspaceId, account.id, key)
    if (!automation) throw new Error(`could not create ${key}`)
    const published = await publishAutomation(workspaceId, automation.id)
    if (!published.ok) throw new Error(`could not publish ${key}: ${published.errors.join(', ')}`)
    const [row] = await db().select({ versionId: automations.currentVersionId }).from(automations).where(eq(automations.id, automation.id))
    if (row?.versionId) live.push({ id: automation.id, versionId: row.versionId })
  }
  // One draft so the list shows every state.
  await createAutomation(workspaceId, account.id, 'phone_numbers')

  for (const [index, username] of PEOPLE.entries()) {
    const [contact] = await db()
      .insert(contacts)
      .values({
        workspaceId,
        connectedAccountId: account.id,
        platformUserId: `demo_${index}`,
        username,
        name: username.split('.')[0]?.replace(/^./, (c) => c.toUpperCase()) ?? username,
        email: index % 3 === 0 ? `${username.replace('.', '')}@example.com` : null,
        phone: index % 5 === 1 ? `+91 98765 ${String(43210 + index).slice(-5)}` : null,
        tags: index % 4 === 0 ? ['email-lead', 'vip'] : index % 3 === 0 ? ['email-lead'] : [],
        lastInboundAt: minutesAgo(index * 37 + 2),
        firstSeenAt: minutesAgo(index * 600 + 60),
      })
      .returning()
    if (!contact) continue

    const automation = live[index % live.length]
    if (!automation) continue
    const status = STATUSES[index % STATUSES.length] ?? 'completed'
    const [run] = await db()
      .insert(flowRuns)
      .values({
        automationId: automation.id,
        automationVersionId: automation.versionId,
        contactId: contact.id,
        connectedAccountId: account.id,
        status,
        createdAt: minutesAgo(index * 37 + 5),
        completedAt: status === 'completed' ? minutesAgo(index * 37 + 3) : null,
      })
      .returning()

    await db().insert(messages).values([
      {
        contactId: contact.id,
        connectedAccountId: account.id,
        flowRunId: run?.id ?? null,
        direction: 'in',
        kind: 'comment',
        body: { text: 'GUIDE', mediaId: 'demo_media' },
        status: 'received',
        createdAt: minutesAgo(index * 37 + 6),
      },
      {
        contactId: contact.id,
        connectedAccountId: account.id,
        flowRunId: run?.id ?? null,
        direction: 'out',
        kind: 'private_reply',
        body: { type: 'message', message: { text: "Hey! Tap below and I'll send it over 👇" } },
        status: 'sent',
        sentAt: minutesAgo(index * 37 + 5),
        createdAt: minutesAgo(index * 37 + 5),
      },
    ])
  }

  await db().insert(usageCounters).values({ workspaceId, period: usagePeriod(new Date()), contactsReached: PEOPLE.length })
  console.log(`Seeded ${EMAIL} / ${PASSWORD}`)
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(closeDb)
