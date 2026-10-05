import { getTemplate, type FlowDefinition } from '@replyooo/shared'
import { DEFAULT_RECIPE, compileRecipe, type Recipe } from '../recipe'
import type { Automation, ConnectedAccount, Contact, Member, Subscription, Workspace } from './types'

const DAY = 86_400_000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

function templateFlow(key: string, patch?: (flow: FlowDefinition) => void): FlowDefinition {
  const template = getTemplate(key)
  if (!template) throw new Error(`Unknown template ${key}`)
  const flow = structuredClone(template.flow)
  patch?.(flow)
  return flow
}

const breakfastRecipe: Recipe = {
  ...structuredClone(DEFAULT_RECIPE),
  trigger: {
    type: 'comment_keyword',
    posts: { mode: 'specific', mediaIds: ['reel_breakfast'] },
    keywords: ['GUIDE', 'breakfast'],
    match: 'contains',
    publicReplies: { enabled: true, replies: ['Sent! Check your DMs ✨', "Just DM'd you 💛", 'On its way — check requests!'] },
  },
  opener: {
    enabled: true,
    text: 'Hey {{first_name|there}}! Want my 7-day high-protein meal plan? Tap below 👇',
    buttonLabel: 'Send it to me',
  },
  followGate: { ...DEFAULT_RECIPE.followGate, enabled: true },
  collect: { kind: 'email', question: "What's your email? I'll send a copy there too.", retryText: "Hmm, that doesn't look like an email. Mind trying again?" },
  message: {
    text: "Here you go! 🎉 Save it so you don't lose it.",
    link: { enabled: true, label: 'Get the guide', url: 'https://mayamakes.co/7day' },
  },
  tags: ['email-lead'],
}

export function seed() {
  const workspace: Workspace = { id: 'ws_1', name: 'Maya Makes', user: { name: 'Maya Lopez', email: 'maya@mayamakes.co' } }

  const accounts: ConnectedAccount[] = [
    { id: 'acc_ig', platform: 'instagram', username: 'maya.makes', displayName: 'Maya Makes', followers: 412_000, status: 'active' },
    { id: 'acc_fb', platform: 'facebook', username: 'mayamakeskitchen', displayName: 'Maya Makes Kitchen', followers: 38_200, status: 'reauth_required' },
  ]

  const automations: Automation[] = [
    {
      id: 'aut_breakfast',
      accountId: 'acc_ig',
      name: '3 high-protein breakfasts',
      status: 'active',
      flow: compileRecipe(breakfastRecipe),
      version: 4,
      templateKey: 'email_list',
      updatedAt: ago(2 * 60_000),
      publishedAt: ago(3 * DAY),
      stats: { runs: 9_412, completed: 7_908, dmsSent: 24_816, leads: 1_874 },
    },
    {
      id: 'aut_pantry',
      accountId: 'acc_ig',
      name: 'Pantry checklist',
      status: 'active',
      flow: templateFlow('comment_to_dm', (flow) => {
        if (flow.trigger.type === 'comment_keyword') flow.trigger.keywords = ['LIST', 'CHECKLIST']
      }),
      version: 2,
      templateKey: 'comment_to_dm',
      updatedAt: ago(5 * DAY),
      publishedAt: ago(5 * DAY),
      stats: { runs: 3_507, completed: 3_211, dmsSent: 6_722, leads: 0 },
    },
    {
      id: 'aut_freebie',
      accountId: 'acc_ig',
      name: 'Brunch meal-prep carousel',
      status: 'active',
      flow: templateFlow('follow_gate', (flow) => {
        if (flow.trigger.type === 'comment_keyword') flow.trigger.keywords = ['RECIPE']
      }),
      version: 1,
      templateKey: 'follow_gate',
      updatedAt: ago(9 * DAY),
      publishedAt: ago(9 * DAY),
      stats: { runs: 2_960, completed: 2_114, dmsSent: 7_340, leads: 0 },
    },
    {
      id: 'aut_story',
      accountId: 'acc_ig',
      name: 'Story replies',
      status: 'active',
      flow: templateFlow('story_replies'),
      version: 1,
      templateKey: 'story_replies',
      updatedAt: ago(14 * DAY),
      publishedAt: ago(14 * DAY),
      stats: { runs: 4_118, completed: 4_118, dmsSent: 4_118, leads: 0 },
    },
    {
      id: 'aut_price',
      accountId: 'acc_ig',
      name: '“price” questions',
      status: 'active',
      flow: templateFlow('dm_keyword', (flow) => {
        if (flow.trigger.type === 'dm_keyword') flow.trigger.keywords = ['PRICE', 'COST']
      }),
      version: 3,
      templateKey: 'dm_keyword',
      updatedAt: ago(20 * DAY),
      publishedAt: ago(20 * DAY),
      stats: { runs: 1_903, completed: 1_903, dmsSent: 1_903, leads: 0 },
    },
    {
      id: 'aut_waitlist',
      accountId: 'acc_ig',
      name: 'Holiday cookbook waitlist',
      status: 'paused',
      flow: templateFlow('email_list', (flow) => {
        if (flow.trigger.type === 'comment_keyword') flow.trigger.keywords = ['WAITLIST']
      }),
      version: 1,
      templateKey: 'email_list',
      updatedAt: ago(30 * DAY),
      publishedAt: ago(40 * DAY),
      stats: { runs: 428, completed: 301, dmsSent: 1_012, leads: 288 },
    },
    {
      id: 'aut_workshop',
      accountId: 'acc_ig',
      name: 'Spring workshop',
      status: 'draft',
      flow: templateFlow('phone_numbers', (flow) => {
        if (flow.trigger.type === 'comment_keyword') flow.trigger.keywords = ['WORKSHOP']
      }),
      version: 0,
      templateKey: 'phone_numbers',
      updatedAt: ago(DAY),
      publishedAt: null,
      stats: { runs: 0, completed: 0, dmsSent: 0, leads: 0 },
    },
    {
      id: 'aut_fb_starters',
      accountId: 'acc_fb',
      name: 'Page conversation starters',
      status: 'active',
      flow: templateFlow('conversation_starters'),
      version: 1,
      templateKey: 'conversation_starters',
      updatedAt: ago(12 * DAY),
      publishedAt: ago(12 * DAY),
      stats: { runs: 640, completed: 640, dmsSent: 640, leads: 0 },
    },
  ]

  const people = [
    ['sam.eats', 'Sam Rivera'],
    ['priya.plates', 'Priya Nair'],
    ['devfit', 'Dev Arora'],
    ['lenalifts', 'Lena Fischer'],
    ['the.oat.girl', 'Hana Sato'],
    ['marco_cooks', 'Marco Bianchi'],
    ['jules.bakes', 'Jules Martin'],
    ['noah.runs', 'Noah Kim'],
    ['ava.greens', 'Ava Thompson'],
    ['kofi.kitchen', 'Kofi Mensah'],
    ['zoe.meals', 'Zoe Clarke'],
    ['ibrahim.fit', 'Ibrahim Khan'],
    ['mila.mornings', 'Mila Novak'],
    ['tomas.tastes', 'Tomás Ruiz'],
  ] as const

  const contacts: Contact[] = people.map(([username, name], index): Contact => {
    const first = name.split(' ')[0]!.toLowerCase()
    const hasEmail = index % 3 !== 2
    const hasPhone = index % 4 === 1
    const tags = [
      ...(hasEmail ? ['email-lead'] : []),
      ...(hasPhone ? ['phone-lead'] : []),
      ...(index % 5 === 0 ? ['vip'] : []),
    ]
    const seen = (index + 1) * 0.7 * DAY
    return {
      id: `ct_${index + 1}`,
      accountId: index === 13 ? 'acc_fb' : 'acc_ig',
      username,
      name,
      email: hasEmail ? `${first}@example.com` : null,
      phone: hasPhone ? `+1 555 01${String(index).padStart(2, '0')}` : null,
      tags,
      fields: index % 2 === 0 ? { goal: index % 4 === 0 ? 'muscle' : 'energy' } : ({} as Record<string, string>),
      firstSeenAt: ago(seen + 6 * DAY),
      lastInboundAt: ago(seen),
      messages: [
        { direction: 'in', text: 'GUIDE 🙌', at: ago(seen + 4 * 60_000) },
        { direction: 'out', text: `Hey ${name.split(' ')[0]}! Want my 7-day high-protein meal plan? Tap below 👇`, at: ago(seen + 3 * 60_000) },
        { direction: 'in', text: 'Send it to me', at: ago(seen + 2 * 60_000) },
        ...(hasEmail
          ? ([
              { direction: 'out', text: "What's your email? I'll send a copy there too.", at: ago(seen + 90_000) },
              { direction: 'in', text: `${first}@example.com`, at: ago(seen + 60_000) },
            ] as const)
          : []),
        { direction: 'out', text: "Here you go! 🎉 Save it so you don't lose it.", at: ago(seen) },
      ],
      runs: [
        { automationName: '3 high-protein breakfasts', status: hasEmail ? 'completed' : 'expired', at: ago(seen) },
        ...(index % 3 === 0 ? [{ automationName: '“price” questions', status: 'completed' as const, at: ago(seen + 2 * DAY) }] : []),
      ],
    }
  })

  const members: Member[] = [
    { id: 'mem_1', name: 'Maya Lopez', email: 'maya@mayamakes.co', role: 'owner' },
    { id: 'mem_2', name: 'Chris Park', email: 'chris@mayamakes.co', role: 'admin' },
  ]

  const subscription: Subscription = {
    plan: 'pro',
    contactsReached: 3_412,
    contactsLimit: 5_000,
    periodEnd: new Date(Date.now() + 9 * DAY).toISOString(),
  }

  return { workspace, accounts, automations, contacts, members, subscription }
}
