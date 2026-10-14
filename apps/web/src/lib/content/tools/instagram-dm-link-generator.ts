import type { ToolPage } from '@/lib/content/types'

export const instagramDmLinkGenerator: ToolPage = {
  slug: 'instagram-dm-link-generator',
  name: 'DM link generator',
  tool: 'dm-link',
  title: 'Instagram DM link generator',
  metaTitle: 'Instagram DM link generator (ig.me) — free',
  description:
    'Make a link that opens a DM with your Instagram account (ig.me) or Facebook Page (m.me), plus a QR code to print. Free, no signup.',
  lead: 'Type your username and get a link that opens a chat with you in one tap. Put it in your bio, a link-in-bio page, an email or a QR code.',
  steps: [
    { title: 'Enter your username', body: 'Your Instagram username or Facebook Page username. A pasted @handle or profile link works too.' },
    { title: 'Copy the link or the QR code', body: 'Instagram links look like ig.me/m/username, Facebook ones like m.me/username. Download the QR code as PNG or SVG.' },
    { title: 'Share it', body: 'Anyone who taps the link or scans the code lands in a DM with you, in the app on a phone or in the browser on a computer.' },
  ],
  pitch: {
    title: 'Answer those DMs automatically',
    body: 'A DM link brings people into your inbox. Replyooo replies to them for you: a keyword reply, conversation starters, or a full flow that collects an email and sends your link.',
    href: '/features/instagram-dm-auto-reply',
    cta: 'See DM auto-reply',
  },
  faqs: [
    {
      question: 'What is an ig.me link?',
      answer:
        'ig.me is Instagram’s own short link domain. ig.me/m/ followed by a username opens a DM with that account. On a phone it opens the Instagram app; on a computer it opens Instagram on the web.',
    },
    {
      question: 'Does the person need to follow me?',
      answer: 'No. Anyone with an Instagram account can open the chat. If they don’t follow you, the message may land in your message requests.',
    },
    {
      question: 'Can I add a pre-filled message?',
      answer: 'Instagram doesn’t document a way to pre-fill the message on ig.me links, so this tool doesn’t add one. The person types their own first message.',
    },
    {
      question: 'Which QR code file should I use?',
      answer:
        'PNG for social posts, slides and most printing. SVG for a designer or a print shop: it stays sharp at any size. Either way, scan it with your own phone before you print a batch.',
    },
    {
      question: 'Do you check that the account exists?',
      answer: 'No. The tool only checks that the username uses allowed characters. Open the link once yourself before you share it.',
    },
  ],
  related: ['instagram-dm-reply-generator', 'utm-link-builder'],
  updated: '2026-10-15',
}
