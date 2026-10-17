export type DashboardIssue = { code: string; values?: Record<string, string | number> }

/** Adapter for existing action contracts. Only known application messages are translated. */
const codes: Record<string, string> = {
  'This automation no longer exists': 'automationMissing',
  'Automation not found': 'automationMissing',
  'This automation was changed in another tab. Reload to get the latest version.': 'conflict',
  'Fix the highlighted fields before saving': 'invalidDraft',
  'Publish this automation first': 'publishFirst',
  "Couldn't reach Replyooo. Check your connection and try again.": 'network',
  'Account not found': 'accountMissing',
  'Add at least one keyword (max 100 characters each)': 'keywords',
  'Public replies must be 1–500 characters': 'publicReplies',
  'Each question needs text (max 80 characters) and an answer': 'question',
  'Button labels must be 1–20 characters': 'buttonLabel',
  'Add at least one product card (max 10)': 'cards',
  'Card titles and subtitles must be 1–80 characters': 'cardText',
  'Product cards are only available on Instagram': 'cardsInstagramOnly',
  'Enter a valid link, including https://': 'link',
  'Enter a valid image link, including https://': 'image',
  'Messages must be 1–1000 characters': 'messageLength',
  'Tags must be 1–50 characters': 'tags',
  'Pick at least one story': 'pickStory',
  'Pick at least one post': 'pickPost',
  'Story replies are only available on Instagram': 'instagramOnly',
  'Keywords made only of punctuation can never match': 'punctuation',
  'A message with reply buttons continues from its buttons, not from "next"': 'buttonFlow',
  'Two buttons on this message share an id': 'duplicateButton',
  'A reminder needs a reply button to wait on': 'reminderButton',
  'The reminder must come before the question times out': 'reminderTimeout',
  'Meta allows only one message after a comment until the person replies, so this step cannot send a reminder': 'commentReminder',
  'A follow-up for unopened links needs a link button on this message': 'clickFollowUpLinks',
  'Meta allows only one message after a comment until the person replies, so this step cannot send a follow-up': 'commentClickFollowUp',
  'Answers saved to email/phone must use matching validation': 'answerValidation',
  'Comment automations must start with a message that has a reply button — Meta allows only one message until the person replies': 'commentButton',
  'The first message after a comment is a single private reply and cannot include an image': 'commentImage',
  'This step can never be reached': 'unreachable',
  'This loop never waits for the person, so it would repeat forever': 'loop',
  'Add a display name': 'displayName',
  'Add a title': 'title',
  'Check the highlighted fields': 'invalidDraft',
  'Check the title': 'title',
  'Enter a valid web address (https://…)': 'link',
  'Unknown block type': 'blockType',
  'This block no longer exists': 'blockMissing',
  'Copy failed. Select the address and copy it manually.': 'clipboard',
  'A { or } has no partner, so customers would see it as typed. Use the Variables menu to insert one.': 'unpairedBraces',
}

export function dashboardIssue(message: string): DashboardIssue {
  if (Object.hasOwn(codes, message)) return { code: codes[message]! }
  const unknown = /^(.*) isn't a variable we know, so it will be sent blank\.$/.exec(message)
  if (unknown) return { code: 'unknownVariable', values: { variable: unknown[1]! } }
  const length = /^(Name|Bio|Titles) can be up to (\d+) characters$/.exec(message)
  if (length)
    return {
      code: ({ Name: 'nameLength', Bio: 'bioLength', Titles: 'titleLength' } as Record<string, string>)[length[1]!]!,
      values: { count: Number(length[2]) },
    }
  const blocks = /^A page can have up to (\d+) blocks$/.exec(message)
  if (blocks) return { code: 'blockLimit', values: { count: Number(blocks[1]) } }
  const reauth = /^Meta revoked access to @(.+)\. Reconnect it in Settings(?:, then publish again|)\.$/.exec(message)
  if (reauth) return { code: 'reconnect', values: { username: reauth[1]! } }
  if (message.startsWith('Couldn’t load your posts from Meta:')) return { code: 'postsFailed' }
  if (message.startsWith('Couldn’t load your stories from Meta:')) return { code: 'storiesFailed' }
  if (message.startsWith('Meta didn’t accept the conversation starters:')) return { code: 'startersFailed' }
  const limit = /^Your (.+) plan allows (\d+) live automations\. Pause one or upgrade in Settings → Billing\.$/.exec(message)
  if (limit) return { code: 'automationLimit', values: { count: Number(limit[2]) } }
  const buttonLength = /^Messages with buttons can be at most (\d+) characters$/.exec(message)
  if (buttonLength) return { code: 'buttonMessageLength', values: { count: Number(buttonLength[1]) } }
  const followUpLength = /^A follow-up with link buttons can be at most (\d+) characters$/.exec(message)
  if (followUpLength) return { code: 'followUpButtonLength', values: { count: Number(followUpLength[1]) } }
  if (/^(Start step|Step) ".+" does not exist$/.test(message)) return { code: 'invalidStep' }
  const steps = /^A flow can have at most (\d+) steps$/.exec(message)
  if (steps) return { code: 'stepLimit', values: { count: Number(steps[1]) } }
  if (message.startsWith('More than ') && message.includes('steps in a row without waiting')) return { code: 'waitNeeded' }
  return { code: 'generic' }
}
