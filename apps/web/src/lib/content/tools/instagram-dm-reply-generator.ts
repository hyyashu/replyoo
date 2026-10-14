import type { ToolPage } from '@/lib/content/types'

export const instagramDmReplyGenerator: ToolPage = {
  slug: 'instagram-dm-reply-generator',
  name: 'DM reply generator',
  tool: 'dm-replies',
  title: 'Instagram DM reply generator',
  metaTitle: 'Instagram DM reply generator: free reply templates',
  description:
    'Ready-to-send replies for the DMs you get every day: price questions, link requests, bookings, orders, collabs and complaints. Pick a tone, add your details, copy.',
  lead: 'Pick what they asked about and the tone you want, add your link or price, and copy a reply. Written templates, ready to paste into Instagram.',
  steps: [
    { title: 'Pick the situation', body: 'A price question, a link request, a booking, an order, a collab, a kind message or a complaint.' },
    { title: 'Choose a tone and fill in', body: 'Friendly, professional or short. Add their name, your offer, price or link where the reply needs them.' },
    { title: 'Copy and send', body: 'Each situation has two replies per tone. Edit anything you like before you send.' },
  ],
  pitch: {
    title: 'Send the reply without typing it',
    body: 'If you send the same reply every day, let Replyooo send it. Set a keyword like PRICE or LINK and the right reply goes out within seconds, any time of day.',
    href: '/features/instagram-dm-auto-reply',
    cta: 'See DM auto-reply',
  },
  faqs: [
    {
      question: 'Is this AI?',
      answer:
        'No. Every reply is a template we wrote, filled in with the details you type. That keeps them predictable: nothing is invented, and the same input always gives the same reply.',
    },
    {
      question: 'Can I send these automatically?',
      answer:
        'Yes, with Replyooo. Create an automation that triggers on a keyword in a DM or a comment, paste the reply, and add your link as a button. It sends within seconds through Meta’s official API.',
    },
    {
      question: 'Are these short enough for an automated DM?',
      answer: 'Yes. Every template fits within the 1,000-character limit for messages sent through Meta’s messaging API, even with a long link.',
    },
    {
      question: 'Is what I type saved?',
      answer: 'No. The replies are filled in in your browser, and nothing is sent to us.',
    },
  ],
  related: ['instagram-dm-link-generator', 'instagram-character-counter'],
  updated: '2026-10-15',
}
