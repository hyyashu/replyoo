import type { ToolPage } from '@/lib/content/types'

export const instagramCharacterCounter: ToolPage = {
  slug: 'instagram-character-counter',
  name: 'Character counter',
  tool: 'text-limits',
  title: 'Instagram character counter',
  metaTitle: 'Instagram character counter for captions, bios and DMs',
  description:
    'Count characters for Instagram captions (2,200), bios (150) and automated DMs. Emoji count as one character. Also counts words, hashtags and mentions.',
  lead: 'Paste a caption, bio or DM and see how much room is left before you post. Emoji and accented letters count once, the way they look.',
  steps: [
    { title: 'Pick what you are writing', body: 'A caption, a bio, or a DM for an automation, with or without buttons.' },
    { title: 'Paste or type', body: 'The count updates as you type, with the limit for what you picked.' },
    { title: 'Trim if needed', body: 'Over the limit turns red, so you know before Instagram cuts it off or rejects it.' },
  ],
  pitch: {
    title: 'Write the DM once, send it to every commenter',
    body: 'Replyooo checks your automated DMs against these limits as you write them, then sends them to everyone who comments your keyword.',
    href: '/features/instagram-comment-to-dm',
    cta: 'See comment-to-DM',
  },
  faqs: [
    {
      question: 'How long can an Instagram caption be?',
      answer: '2,200 characters. Only the first lines show before “more”, so put the important part first.',
    },
    {
      question: 'How long can an Instagram bio be?',
      answer: '150 characters.',
    },
    {
      question: 'Why do automated DMs have two limits?',
      answer:
        'Messages sent through Meta’s messaging API can be up to 1,000 characters. A message with buttons under it uses a template that allows 640 characters of text. Replyooo enforces both when you build an automation.',
    },
    {
      question: 'Why does my count differ from another counter?',
      answer:
        'Some counters count the code units behind an emoji, so one emoji can count as 2 or more. This one counts what you see, so a skin-toned or family emoji counts as one.',
    },
  ],
  related: ['instagram-dm-reply-generator', 'instagram-dm-link-generator'],
  updated: '2026-10-15',
}
