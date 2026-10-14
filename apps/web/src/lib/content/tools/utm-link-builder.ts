import type { ToolPage } from '@/lib/content/types'

export const utmLinkBuilder: ToolPage = {
  slug: 'utm-link-builder',
  name: 'UTM link builder',
  tool: 'utm',
  title: 'UTM link builder for Instagram',
  metaTitle: 'UTM link builder for Instagram links — free',
  description:
    'Add UTM parameters to the links you share on Instagram, in your bio, stories and DMs, so your analytics shows which post or message sent each visit.',
  lead: 'Tag the links you share on Instagram so your website analytics can tell a bio click from a story tap or a DM. Free, nothing to install.',
  steps: [
    { title: 'Paste your link', body: 'The page you want people to visit. Any existing query parameters are kept.' },
    { title: 'Fill in the tags', body: 'Source is required; medium and campaign are recommended. Pick a preset to start.' },
    { title: 'Copy and share', body: 'Use the tagged link in your bio, a story link sticker or an automated DM.' },
  ],
  pitch: {
    title: 'Send tagged links by DM, and see who tapped',
    body: 'Replyooo sends your links in automated DMs and counts the taps on each automation, so you see clicks per post without guessing.',
    href: '/features/instagram-comment-to-dm',
    cta: 'See comment-to-DM',
  },
  faqs: [
    {
      question: 'What are UTM parameters?',
      answer:
        'They are tags added to the end of a link (utm_source, utm_medium, utm_campaign, utm_content, utm_term). Analytics tools such as Google Analytics read them to report where each visit came from.',
    },
    {
      question: 'Which values should I use for Instagram?',
      answer:
        'A common setup is source "instagram", medium for the placement ("bio", "story", "dm" or "social"), and campaign for what you are promoting. Pick one spelling and keep it: analytics treats "Instagram" and "instagram" as different sources.',
    },
    {
      question: 'Do UTM tags change the page people see?',
      answer: 'No. The page loads the same. Only your analytics reads the tags.',
    },
    {
      question: 'Is my link sent anywhere?',
      answer: 'No. The link is built in your browser and never leaves it.',
    },
  ],
  related: ['instagram-dm-link-generator', 'instagram-engagement-rate-calculator'],
  updated: '2026-10-15',
}
