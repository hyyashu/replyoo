import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPage } from '@/components/marketing'
import { LEGAL } from '@/lib/legal'

export const metadata: Metadata = { title: 'Terms of service', alternates: { canonical: '/terms' } }

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated={LEGAL.updated}>
      <p>
        These terms are an agreement between you and {LEGAL.company} for using Replyooo. By creating an account you accept them.
      </p>

      <h2>Your account</h2>
      <p>
        You’re responsible for your workspace, the people you invite to it, and keeping your password safe. You must be able to enter a
        contract where you live and have the right to manage every Instagram or Facebook account you connect.
      </p>

      <h2>Acceptable use</h2>
      <ul>
        <li>Follow Instagram’s and Facebook’s terms and community guidelines, and Meta’s messaging policies, including the 24-hour messaging window.</li>
        <li>Only message people who contacted your account first, and don’t send spam, deceptive content or anything illegal.</li>
        <li>Don’t try to break, overload or reverse-engineer the service, or access other customers’ data.</li>
      </ul>
      <p>We may suspend automations or accounts that put Meta’s access for all customers at risk.</p>

      <h2>Plans and billing</h2>
      <p>
        Paid plans renew monthly or yearly, depending on the billing period you choose, until cancelled. Dodo Payments is our merchant of record and handles payment, invoices, taxes and
        refunds under its own terms. You can change or cancel your plan in Settings → Billing; a cancelled plan stays active until the end
        of the period you paid for. Usage limits are listed on the <Link href="/pricing">pricing page</Link>.
      </p>

      <h2>Your content and data</h2>
      <p>
        You own the automations you write and the data of your contacts. You let us process it only to run the service, as described in
        our <Link href="/privacy">privacy policy</Link>. You’re responsible for having a lawful basis to collect the emails and phone
        numbers your automations ask for.
      </p>

      <h2>Availability</h2>
      <p>
        We work to keep Replyooo running, but it depends on Meta’s platform, which can change or limit access at any time. The service is
        provided “as is”, without warranties beyond what the law requires.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent the law allows, our total liability for any claim is limited to what you paid us in the 12 months before it, and
        we’re not liable for indirect or consequential losses, such as lost profits or followers.
      </p>

      <h2>Ending the agreement</h2>
      <p>
        You can delete your workspace at any time in Settings. We may end accounts that break these terms, after notice where possible.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.
      </p>
    </LegalPage>
  )
}
