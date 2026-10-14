import type { Metadata } from 'next'
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from 'next/font/google'
import { BASE_OPEN_GRAPH } from '@/lib/metadata'
import { getSiteUrl } from '@/lib/site'
import { headers } from 'next/headers'
import { DASHBOARD_HEADER, locales } from '@/i18n/locales'
import { getDashboardLocale } from '@/i18n/request'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const bricolage = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-bricolage' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' })

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(await getSiteUrl()),
    title: { default: 'Replyooo — Turn every comment into a customer', template: '%s · Replyooo' },
    description: 'Instagram and Facebook DM automation for creators. Reply to comments, stories and DMs in seconds.',
    openGraph: { siteName: BASE_OPEN_GRAPH.siteName, type: BASE_OPEN_GRAPH.type, locale: BASE_OPEN_GRAPH.locale },
    twitter: { card: 'summary_large_image' },
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = (await headers()).get(DASHBOARD_HEADER) === '1' ? await getDashboardLocale() : 'en'
  return (
    <html lang={locale} dir={locales[locale].direction} className={`${inter.variable} ${bricolage.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  )
}
