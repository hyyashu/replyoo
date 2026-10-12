import { DashboardProvider } from '@/i18n/provider'

export default function FeatureLayout({ children }: { children: React.ReactNode }) {
  return <DashboardProvider namespaces={['automations']}>{children}</DashboardProvider>
}
