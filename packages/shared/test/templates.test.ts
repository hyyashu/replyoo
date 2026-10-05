import { describe, expect, it } from 'vitest'
import { FlowDefinitionSchema, TEMPLATES, getTemplate, validateFlow } from '../src'

describe('templates', () => {
  it('has the 7 v1 templates with unique keys', () => {
    expect(TEMPLATES.map((t) => t.key).sort()).toEqual([
      'comment_to_dm',
      'conversation_starters',
      'dm_keyword',
      'email_list',
      'follow_gate',
      'phone_numbers',
      'story_replies',
    ])
  })

  it.each(TEMPLATES.map((t) => [t.key, t] as const))('%s parses and validates on its platforms', (_key, template) => {
    expect(FlowDefinitionSchema.parse(template.flow)).toEqual(template.flow)
    for (const platform of template.platforms) {
      expect(validateFlow(template.flow, platform)).toEqual([])
    }
  })

  it('marks Instagram-only templates', () => {
    expect(getTemplate('follow_gate')?.platforms).toEqual(['instagram'])
    expect(getTemplate('story_replies')?.platforms).toEqual(['instagram'])
    expect(getTemplate('email_list')?.platforms).toEqual(['instagram', 'facebook'])
  })

  it('returns undefined for unknown keys', () => {
    expect(getTemplate('nope')).toBeUndefined()
  })
})
