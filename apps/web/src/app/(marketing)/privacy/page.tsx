import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPage } from '@/components/marketing'
import { LEGAL } from '@/lib/legal'

export const metadata: Metadata = { title: 'Privacy policy' }

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated={LEGAL.updated}>
      <p>
        {LEGAL.company} (“we”) runs Replyooo, a tool that replies to Instagram and Facebook comments and messages for the businesses and
        creators who connect their accounts (“customers”). This policy explains what we collect, why, and how to get it deleted.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>Customer accounts: name, email address, password (stored hashed) or Google sign-in, and workspace membership.</li>
        <li>
          Connected Instagram and Facebook accounts: account ID, username, name, profile picture, follower count and the access token
          Meta issues (encrypted with AES-256-GCM).
        </li>
        <li>
          People who interact with a connected account (“contacts”): their Instagram or Facebook ID, username, name and profile picture,
          the comments and messages they send to that account, the replies Replyooo sends, and any email address or phone number they
          choose to share in the conversation.
        </li>
        <li>Billing: plan, subscription status and the customer ID from Dodo Payments. We never see or store card details.</li>
      </ul>

      <h2>How we use it</h2>
      <p>
        Only to provide the service our customers set up: matching comments and messages to their automations, sending the replies they
        wrote, showing their contacts and conversation history in the dashboard, counting usage for billing, and emailing customers about
        their account (verification, password resets, invitations, and when Meta needs them to reconnect). We don’t sell personal data,
        use it for advertising, or combine data from different customers.
      </p>

      <h2>Data from Meta</h2>
      <p>
        We use Instagram and Facebook Platform data only to operate the features the connected account’s owner turned on, in line with
        Meta’s Platform Terms. Access ends when the owner disconnects the account in Replyooo or removes Replyooo in their Instagram or
        Facebook settings.
      </p>

      <h2>Who processes it for us</h2>
      <ul>
        <li>Our hosting provider, which runs our servers and database.</li>
        <li>Dodo Payments, our merchant of record, for subscriptions and invoices.</li>
        <li>Our email provider (Resend or our SMTP provider), to deliver account emails.</li>
        <li>Meta, to receive and send the messages and comments themselves.</li>
      </ul>

      <h2>How long we keep it</h2>
      <p>
        Raw webhook deliveries from Meta are deleted after 30 days. Everything else is kept until the customer deletes it, deletes their
        workspace, or the account owner asks Meta to delete their data. Deleting a workspace removes its connected accounts, contacts,
        messages and automations immediately.
      </p>

      <h2>Your choices</h2>
      <p>
        Contacts can ask the business they messaged, or us, to delete what we hold about them. Account owners can delete their data at
        any time; see <Link href="/data-deletion">how to delete your data</Link>. Write to{' '}
        <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a> for any privacy request; we answer within 30 days.
      </p>

      <h2>Security</h2>
      <p>
        Access tokens are encrypted at rest, passwords are hashed, every request is checked against the signed-in workspace, and Meta’s
        webhooks are verified by signature before we process them.
      </p>

      <h2>Changes</h2>
      <p>We’ll update the date above when this policy changes, and email customers about material changes.</p>
    </LegalPage>
  )
}
