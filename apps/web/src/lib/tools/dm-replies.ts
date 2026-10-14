export type ReplyField = 'name' | 'offer' | 'price' | 'link'
export type ReplyTone = 'friendly' | 'professional' | 'short'

export const REPLY_TONES: { value: ReplyTone; label: string }[] = [
  { value: 'friendly', label: 'Friendly' },
  { value: 'professional', label: 'Professional' },
  { value: 'short', label: 'Short' },
]

/** What each field is called in the form, and what shows in the reply until it's filled in. Name is optional and simply left out. */
export const REPLY_FIELDS: Record<ReplyField, { label: string; placeholder: string; missing: string }> = {
  name: { label: 'Their first name (optional)', placeholder: 'Sam', missing: '' },
  offer: { label: 'What you offer', placeholder: 'the 5-day meal plan', missing: '[your offer]' },
  price: { label: 'Price', placeholder: '$29', missing: '[price]' },
  link: { label: 'Link', placeholder: 'https://example.com/plan', missing: '[your link]' },
}

export interface ReplyScenario {
  label: string
  /** The kind of message they sent, shown as an example. */
  example: string
  fields: ReplyField[]
  replies: Record<ReplyTone, string[]>
}

export type ReplyScenarioKey = 'price' | 'link' | 'freebie' | 'booking' | 'order' | 'collab' | 'thanks' | 'complaint'

/** Hand-written reply templates. `{field}` is filled from the form; every field used must be listed in `fields`. */
export const REPLY_SCENARIOS: Record<ReplyScenarioKey, ReplyScenario> = {
  price: {
    label: 'Asking the price',
    example: 'How much is it?',
    fields: ['name', 'offer', 'price', 'link'],
    replies: {
      friendly: [
        'Hi {name}! Thanks for asking 😊 {offer} is {price}. Everything is on this page: {link}\nAny questions, just reply here!',
        'Hey {name}! {offer} is {price}, and you can grab it here 👉 {link}\nHappy to help if you’re not sure it’s right for you.',
      ],
      professional: [
        'Hi {name}, thank you for your message. {offer} is {price}. You can find the full details and checkout here: {link}\nPlease let me know if you have any questions.',
        'Hello {name}, thanks for your interest. The price for {offer} is {price}. Details: {link}',
      ],
      short: ['Hi {name}! {offer} is {price} 👉 {link}', '{price} for {offer}. Details here: {link}'],
    },
  },
  link: {
    label: 'Asking for the link',
    example: 'Can you send me the link?',
    fields: ['name', 'offer', 'link'],
    replies: {
      friendly: [
        'Hi {name}! Of course, here’s the link to {offer} 👉 {link}\nEnjoy, and let me know what you think!',
        'Hey {name}! Here you go: {link}\nShout if anything doesn’t work 🙌',
      ],
      professional: [
        'Hi {name}, thanks for reaching out. Here is the link to {offer}: {link}',
        'Hello {name}, here is the link you asked for: {link}\nLet me know if you need anything else.',
      ],
      short: ['Here you go {name} 👉 {link}', 'Link to {offer}: {link}'],
    },
  },
  freebie: {
    label: 'Commented for a freebie',
    example: 'GUIDE',
    fields: ['name', 'offer', 'link'],
    replies: {
      friendly: [
        'Hi {name}! Thanks for commenting 💛 Here’s {offer}, as promised: {link}\nTell me which part helps most!',
        'Hey {name}! Your copy of {offer} is ready 🎉 {link}\nEnjoy it, and save this chat in case you need it later.',
      ],
      professional: [
        'Hi {name}, thank you for your comment. As promised, here is {offer}: {link}\nI hope you find it useful.',
        'Hello {name}, here is your copy of {offer}: {link}\nFeel free to reply here with any questions.',
      ],
      short: ['Here’s {offer}, {name} 👉 {link}', 'As promised: {link} Enjoy!'],
    },
  },
  booking: {
    label: 'Wants to book',
    example: 'Do you have any slots next week?',
    fields: ['name', 'link'],
    replies: {
      friendly: [
        'Hi {name}! I’d love to work with you 😊 You can see my open times and book here: {link}\nPick whatever suits you best!',
        'Hey {name}! All my available slots are here 👉 {link}\nIf none of them work, reply and we’ll figure something out.',
      ],
      professional: [
        'Hi {name}, thank you for getting in touch. You can view availability and book a time here: {link}',
        'Hello {name}, my current availability is on this page: {link}\nOnce you book, you’ll get a confirmation by email.',
      ],
      short: ['Book here {name} 👉 {link}', 'Open times and booking: {link}'],
    },
  },
  order: {
    label: 'Asking about an order',
    example: 'Where is my order?',
    fields: ['name'],
    replies: {
      friendly: [
        'Hi {name}! Sorry for the wait 🙏 Can you send me your order number or the email you ordered with? I’ll check on it right away.',
        'Hey {name}! Let’s find it. Reply with your order number and I’ll get back to you with an update.',
      ],
      professional: [
        'Hi {name}, thank you for your message. Please send your order number or the email used at checkout, and I will look into it for you.',
        'Hello {name}, I’m sorry for the delay. Could you share your order number? I’ll check the status and reply as soon as possible.',
      ],
      short: ['Hi {name}! What’s your order number? I’ll check it now.', 'Send me your order number and I’ll look into it.'],
    },
  },
  collab: {
    label: 'Collab or brand request',
    example: 'We’d love to work with you!',
    fields: ['name', 'link'],
    replies: {
      friendly: [
        'Hi {name}! Thanks so much for thinking of me 😊 My rates and past work are here: {link}\nSend over the details and I’ll take a look!',
        'Hey {name}! I’m open to collabs. Here’s my media kit: {link}\nWhat did you have in mind?',
      ],
      professional: [
        'Hi {name}, thank you for reaching out. My media kit, with rates and audience details, is here: {link}\nPlease share the brief, timeline and budget, and I’ll get back to you.',
        'Hello {name}, thanks for your interest in working together. You can find my media kit here: {link}',
      ],
      short: ['Thanks {name}! Media kit 👉 {link}', 'Rates and details: {link} Send me the brief!'],
    },
  },
  thanks: {
    label: 'Kind message or new follower',
    example: 'Love your content!',
    fields: ['name', 'link'],
    replies: {
      friendly: [
        'Aw, thank you {name}! That really made my day 💛 If you want more, I share extra tips here: {link}',
        'Thank you so much, {name}! So glad you’re here 🙌 Here’s a good place to start: {link}',
      ],
      professional: [
        'Thank you, {name}, I really appreciate it. If it’s helpful, you can find more resources here: {link}',
        'Hi {name}, thank you for the kind words. More of my work is here: {link}',
      ],
      short: ['Thank you {name}! 💛', 'Thanks so much, {name}! More here: {link}'],
    },
  },
  complaint: {
    label: 'Unhappy customer',
    example: 'This isn’t what I expected.',
    fields: ['name'],
    replies: {
      friendly: [
        'Hi {name}, I’m really sorry to hear that 😔 Can you tell me a bit more about what happened? I want to make it right.',
        'Hey {name}, thanks for telling me, and I’m sorry it wasn’t what you hoped. What would help most? I’ll do my best to sort it out.',
      ],
      professional: [
        'Hi {name}, I’m sorry to hear about your experience. Could you share a few more details, including your order number if you have one? I’ll look into it straight away.',
        'Hello {name}, thank you for letting me know, and I apologise. Please share what went wrong and I will find a solution with you.',
      ],
      short: ['So sorry, {name}. What happened? I’ll make it right.', 'Sorry about that. Can you share more details so I can help?'],
    },
  },
}

export const REPLY_SCENARIO_KEYS = Object.keys(REPLY_SCENARIOS) as ReplyScenarioKey[]

/** Fills a template. An empty name is left out with the comma or space before it; other empty fields show a [bracket] to fill in. */
export function renderReply(template: string, values: Partial<Record<ReplyField, string>>): string {
  const withName = values.name?.trim() ? template : template.replace(/,? ?\{name\}/g, '')
  return withName.replace(/\{(\w+)\}/g, (_, key: ReplyField, offset: number) => {
    const value = values[key]?.trim()
    if (!value) return REPLY_FIELDS[key].missing
    // "the meal plan is $29" becomes "The meal plan…" when it opens a sentence. Links are left alone.
    const opensSentence = key !== 'link' && SENTENCE_START.test(withName.slice(0, offset))
    return opensSentence ? value[0]!.toUpperCase() + value.slice(1) : value
  })
}

const SENTENCE_START = /(^|[.!?\n]|\p{Extended_Pictographic})\s*$/u

export function generateReplies(scenario: ReplyScenarioKey, tone: ReplyTone, values: Partial<Record<ReplyField, string>>): string[] {
  return REPLY_SCENARIOS[scenario].replies[tone].map((template) => renderReply(template, values))
}
