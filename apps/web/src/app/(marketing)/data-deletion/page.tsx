import type { Metadata } from 'next'
import { LegalPage } from '@/components/marketing'
import { LEGAL } from '@/lib/legal'

export const metadata: Metadata = { title: 'Delete your data' }

export default function DataDeletionPage() {
  return (
    <LegalPage title="Delete your data" updated={LEGAL.updated}>
      <p>There are three ways to delete the data Replyooo holds about you.</p>

      <h2>1. Delete your workspace</h2>
      <p>
        If you use Replyooo, open Settings → Delete workspace. It immediately deletes every connected account, contact, message and
        automation in that workspace. Your login stays so you can keep using other workspaces; to delete it too, email us (option 3).
      </p>

      <h2>2. Remove Replyooo from Instagram or Facebook</h2>
      <ul>
        <li>Instagram: Settings and activity → Website permissions → Apps and websites → Replyooo → Remove.</li>
        <li>Facebook: Settings &amp; privacy → Settings → Business integrations → Replyooo → Remove.</li>
      </ul>
      <p>
        Removing the app stops Replyooo from using your account. If you also choose to delete your data there, Meta sends us a deletion
        request: we delete the connected account and its contacts, messages and automations (raw webhook deliveries from Meta are
        removed within 30 days), and Meta shows you a confirmation code you can check on our status page.
      </p>

      <h2>3. Email us</h2>
      <p>
        Write to <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a> from the address on your account, or, if you messaged
        a business that uses Replyooo, tell us its Instagram or Facebook username and yours. We confirm when it’s done, within 30 days.
      </p>
    </LegalPage>
  )
}
