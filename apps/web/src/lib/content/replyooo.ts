import { PLAN_LIMITS } from '@replyooo/shared'
import { PLAN_CATALOG } from '@/lib/plans'

const n = (value: number) => new Intl.NumberFormat('en-US').format(value)
const free = PLAN_LIMITS.free
const pro = PLAN_LIMITS.pro
const proPlan = PLAN_CATALOG.find((plan) => plan.key === 'pro')!

/** Replyooo's own numbers, read from the plan catalog so the comparison pages can't drift from /pricing. */
export const ours = {
  freeContacts: n(free.contactsPerMonth),
  proPrice: proPlan.price,
  proContacts: n(pro.contactsPerMonth),
  proAccounts: pro.connectedAccounts,
  free: `${n(free.contactsPerMonth)} contacts a month, ${free.liveAutomations} live automations, ${free.connectedAccounts} account`,
  entryPlan: `${proPlan.price}/month (Pro)`,
  allowance: `${n(pro.contactsPerMonth)} contacts a month, ${pro.connectedAccounts} connected accounts, unlimited live automations`,
  meter: 'Contacts: a person counts once a month, the first time we message them',
  whenLimit: 'Conversations in progress finish; new ones pause until the 1st of next month or you upgrade',
  paid: `Free: ${n(free.contactsPerMonth)} contacts a month. Pro: ${proPlan.price}/month.`,
}
