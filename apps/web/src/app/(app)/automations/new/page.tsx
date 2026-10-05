import { TEMPLATES } from '@replyooo/shared'
import type { Metadata } from 'next'
import { getCurrentAccount } from '@/lib/session'
import { TemplatePicker } from './template-picker'

export const metadata: Metadata = { title: 'New automation' }

export default async function NewAutomationPage() {
  const { account } = await getCurrentAccount()
  return <TemplatePicker templates={[...TEMPLATES]} platform={account.platform} username={account.username} />
}
