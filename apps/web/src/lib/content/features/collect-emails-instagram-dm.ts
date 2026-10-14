import { CONNECT_FAQ, FREE_FAQ, commentTrigger } from '@/lib/content/shared'
import type { MarketingPage } from '@/lib/content/types'
import { DEFAULT_RECIPE } from '@/lib/recipe'

export const collectEmailsInstagramDm: MarketingPage = {
  slug: 'collect-emails-instagram-dm',
  name: 'Email & phone capture',
  title: 'Collect emails and phone numbers in Instagram DMs',
  metaTitle: 'Collect emails in Instagram DMs',
  description:
    'Ask for an email or phone number inside the Instagram chat, validate it, and keep every lead in one place. Build your list straight from comments and stories.',
  lead: 'Before the link goes out, Replyooo asks for an email or phone number in the chat, checks it looks right, and saves it to the contact. Your list grows while you post.',
  recipe: {
    ...DEFAULT_RECIPE,
    trigger: commentTrigger('LIST'),
    opener: { enabled: true, text: 'Hey {{first_name}}! Tap below and I’ll send the template 👇', buttonLabel: 'Send it to me' },
    collect: {
      kind: 'email',
      question: "What's your email? I'll send a copy there too.",
      retryText: "Hmm, that doesn't look like an email. Mind trying again?",
    },
    tags: ['email-lead'],
    message: { text: 'Thanks! 🎉 Here’s the template.', imageUrl: '', links: [{ label: 'Open the template', url: 'https://example.com/template' }] },
  },
  mode: 'dm',
  username: 'maya.makes',
  steps: [
    { title: 'Choose email or phone', body: 'Pick what you want to collect and edit the question so it sounds like you.' },
    { title: 'Replyooo asks and validates', body: 'The person replies in the chat. If it doesn’t look like a real email or number, they get one more try.' },
    { title: 'The lead is saved', body: 'The answer is stored on the contact and tagged, ready to view in Contacts and export as a CSV.' },
  ],
  points: [
    { title: 'Validated answers', body: 'Typos and non-answers are caught in the chat, so your list isn’t full of junk.' },
    { title: 'Skips people you already know', body: 'If a contact has already given their email, Replyooo doesn’t ask again.' },
    { title: 'Export your leads', body: 'Download your contacts as a CSV and move them into whichever email tool you use.' },
    { title: 'Reminders for quiet leads', body: 'Add one gentle reminder for people who start the chat and then go quiet.' },
  ],
  faqs: [
    {
      question: 'Can I collect email addresses through Instagram DMs?',
      answer:
        'Yes. You add an email question to any automation. Replyooo asks it in the chat, validates the answer, saves it on the contact and then sends your link.',
    },
    {
      question: 'Where do the emails go?',
      answer: 'Each one is saved on the contact in Replyooo, with the tag you chose. You can filter your contacts and export them as a CSV.',
    },
    CONNECT_FAQ,
    FREE_FAQ,
  ],
  related: ['instagram-follow-gate', 'instagram-comment-to-dm', 'instagram-dm-auto-reply'],
  updated: '2026-10-09',
}
