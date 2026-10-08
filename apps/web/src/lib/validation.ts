import { FlowDefinitionSchema, validateFlow, type FlowDefinition, type Platform } from '@replyooo/shared'
import { compileRecipe, type Recipe } from './recipe'

export type RecipeSection = 'trigger' | 'publicReply' | 'dm' | 'boosters'

export interface RecipeIssue {
  section: RecipeSection
  message: string
}

const STEP_SECTION: Record<string, RecipeSection> = {
  opener: 'dm',
  deliver: 'dm',
  check: 'boosters',
  ask_follow: 'boosters',
  recheck: 'boosters',
  remind_follow: 'boosters',
  ask: 'boosters',
  has_contact: 'boosters',
  tag: 'boosters',
}

/** Ice-breaker answers are edited inside the trigger section; every other unknown step is the DM message. */
function sectionForStep(id: string): RecipeSection {
  return STEP_SECTION[id] ?? (id.startsWith('answer_') ? 'trigger' : 'dm')
}

/** Runs the same checks the server runs on publish (spec §4.4) and maps them onto form sections. */
export function checkRecipe(recipe: Recipe, platform: Platform): { flow: FlowDefinition; issues: RecipeIssue[] } {
  const flow = compileRecipe(recipe)
  const issues: RecipeIssue[] = []

  const parsed = FlowDefinitionSchema.safeParse(flow)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({ section: sectionForPath(issue.path), message: describe(issue.path, issue.message) })
    }
    return { flow, issues: dedupe(issues) }
  }

  for (const issue of validateFlow(parsed.data, platform)) {
    const section = issue.stepId ? sectionForStep(issue.stepId) : 'trigger'
    issues.push({ section, message: issue.message })
  }
  return { flow, issues: dedupe(issues) }
}

function sectionForPath(path: PropertyKey[]): RecipeSection {
  if (path[0] === 'trigger') return path[1] === 'publicReplies' ? 'publicReply' : 'trigger'
  if (path[0] === 'steps' && typeof path[1] === 'string') return sectionForStep(path[1])
  return 'dm'
}

function describe(path: PropertyKey[], fallback: string): string {
  const [root, key, ...rest] = path
  const last = rest.at(-1) ?? key
  if (root === 'trigger') {
    if (key === 'keywords') return 'Add at least one keyword (max 100 characters each)'
    if (key === 'publicReplies') return 'Public replies must be 1–500 characters'
    if (key === 'items') return 'Each question needs text (max 80 characters) and an answer'
    return fallback
  }
  if (last === 'label') return 'Button labels must be 1–20 characters'
  if (last === 'url') return 'Enter a valid link, including https://'
  if (last === 'imageUrl') return 'Enter a valid image link, including https://'
  if (last === 'text' || last === 'question' || last === 'retryText') return 'Messages must be 1–1000 characters'
  if (rest.includes('add')) return 'Tags must be 1–50 characters'
  return fallback
}

function dedupe(issues: RecipeIssue[]): RecipeIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.section}:${issue.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
