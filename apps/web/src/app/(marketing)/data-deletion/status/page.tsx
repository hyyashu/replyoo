import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketingFooter, MarketingHeader } from '@/components/marketing'
import { db } from '@/lib/db'
import { findDeletionRequest } from '@/lib/meta-callbacks'

export const metadata: Metadata = { title: 'Data deletion status' }

export default async function DeletionStatusPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const { code: raw } = await searchParams
  // A repeated ?code= arrives as an array; only a single value can be a confirmation code.
  const code = typeof raw === 'string' ? raw : ''
  const request = await findDeletionRequest(db(), code)
  return (
    <div className="bg-sand">
      <MarketingHeader />
      <main className="mx-auto max-w-[720px] px-6 py-16">
        <h1 className="font-display text-[40px] leading-tight font-bold tracking-[-0.04em]">Data deletion status</h1>
        {request ? (
          <div className="mt-6 rounded-[20px] bg-white p-6 text-[15px] leading-relaxed text-ink-2">
            <p>
              Request <span className="font-mono">{code}</span> was completed on{' '}
              {request.createdAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}.
            </p>
            <p className="mt-3">
              {request.accountsDeleted === 1 ? '1 connected account was' : `${request.accountsDeleted} connected accounts were`} deleted,
              together with their contacts, conversations and automations.
            </p>
          </div>
        ) : (
          <p className="mt-6 text-[15px] text-muted">
            We couldn’t find that confirmation code. Check the link Meta gave you, or see{' '}
            <Link href="/data-deletion" className="underline">
              how to delete your data
            </Link>
            .
          </p>
        )}
      </main>
      <MarketingFooter />
    </div>
  )
}
