import { DashboardProvider } from '@/i18n/provider'
import { DocumentLanguage } from '@/i18n/document-language'

export default function ConnectLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProvider namespaces={['connect']}>
      <DocumentLanguage />
      {children}
    </DashboardProvider>
  )
}
