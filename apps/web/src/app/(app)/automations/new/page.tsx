import { getTranslations } from 'next-intl/server'
import { TEMPLATES } from '@replyooo/shared'
import type { Metadata } from 'next'
import { getCurrentAccount } from '@/lib/session'
import { TemplatePicker } from './template-picker'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('automations'))('new_automation') }
}

export default async function NewAutomationPage() {
  const tr = await getTranslations('automations')
  const { account } = await getCurrentAccount()
  return (
    <TemplatePicker
      templates={TEMPLATES.map((template) => ({
        ...template,
        title: tr(`template_${template.key}_title`),
        description: tr(`template_${template.key}_description`),
      }))}
      platform={account.platform}
      username={account.username}
    />
  )
}
