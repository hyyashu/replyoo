import { z } from 'zod'

export const StepIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/)
export const KeywordMatchSchema = z.enum(['contains', 'exact'])
export type KeywordMatch = z.infer<typeof KeywordMatchSchema>

const Keyword = z.string().trim().min(1).max(100)
const Keywords = z.array(Keyword).min(1).max(20)
const MessageText = z.string().trim().min(1).max(1000)
const ButtonLabel = z.string().trim().min(1).max(20)
const FieldKey = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/)
const Tag = z.string().trim().min(1).max(50)
const Minutes = z.number().int().min(1).max(10080)

// ---------- Triggers ----------

export const TriggerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('comment_keyword'),
    posts: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('specific'), mediaIds: z.array(z.string().min(1)).max(50) }),
      z.object({ mode: z.literal('any') }),
      z.object({ mode: z.literal('next') }),
    ]),
    /** Empty = every comment on the matching posts. */
    keywords: z.array(Keyword).max(20),
    match: KeywordMatchSchema,
    publicReplies: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
  }),
  z.object({ type: z.literal('dm_keyword'), keywords: Keywords, match: KeywordMatchSchema }),
  z.object({ type: z.literal('any_dm') }),
  z.object({
    type: z.literal('story_reply'),
    includeReactions: z.boolean(),
    keywords: z.array(Keyword).max(20).optional(),
  }),
  z.object({
    type: z.literal('ice_breaker'),
    items: z
      .array(z.object({ question: z.string().trim().min(1).max(80), startStep: StepIdSchema }))
      .min(1)
      .max(4),
  }),
])
export type Trigger = z.infer<typeof TriggerSchema>
export type TriggerType = Trigger['type']
export type TriggerOf<T extends TriggerType> = Extract<Trigger, { type: T }>

// ---------- Buttons ----------

export const ButtonSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('url'), label: ButtonLabel, url: z.url() }),
  z.object({
    type: z.literal('reply'),
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/),
    label: ButtonLabel,
    next: StepIdSchema.optional(),
  }),
])
export type Button = z.infer<typeof ButtonSchema>

// ---------- Steps ----------

export const StepSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('send_message'),
    text: MessageText,
    imageUrl: z.url().optional(),
    buttons: z.array(ButtonSchema).max(3).optional(),
    next: StepIdSchema.optional(),
  }),
  z.object({
    type: z.literal('ask'),
    question: MessageText,
    saveTo: z.union([z.literal('email'), z.literal('phone'), z.object({ field: FieldKey })]),
    validate: z.enum(['email', 'phone', 'text']),
    retryText: MessageText,
    maxAttempts: z.number().int().min(1).max(5),
    timeoutMinutes: Minutes,
    answered: StepIdSchema.optional(),
    invalid: StepIdSchema.optional(),
    timeout: StepIdSchema.optional(),
  }),
  z.object({
    type: z.literal('check_follow'),
    following: StepIdSchema.optional(),
    notFollowing: StepIdSchema.optional(),
  }),
  z.object({ type: z.literal('delay'), minutes: Minutes, next: StepIdSchema.optional() }),
  z.object({
    type: z.literal('tag'),
    add: z.array(Tag).max(10).optional(),
    remove: z.array(Tag).max(10).optional(),
    next: StepIdSchema.optional(),
  }),
  z.object({
    type: z.literal('condition'),
    has: z.union([
      z.literal('email'),
      z.literal('phone'),
      z.object({ tag: Tag }),
      z.object({ field: FieldKey }),
    ]),
    yes: StepIdSchema.optional(),
    no: StepIdSchema.optional(),
  }),
])
export type Step = z.infer<typeof StepSchema>
export type StepType = Step['type']
export type StepOf<T extends StepType> = Extract<Step, { type: T }>

// ---------- Flow ----------

export const FlowDefinitionSchema = z.object({
  trigger: TriggerSchema,
  start: StepIdSchema,
  steps: z.record(StepIdSchema, StepSchema),
})
export type FlowDefinition = z.infer<typeof FlowDefinitionSchema>
