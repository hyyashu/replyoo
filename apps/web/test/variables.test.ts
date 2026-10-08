import { describe, expect, it } from 'vitest'
import { variableProblems } from '../src/lib/variables'

describe('variableProblems', () => {
  it('accepts complete known variables, with spaces and a fallback', () => {
    expect(variableProblems('Hi {{first_name|there}} {{ username }} {{display_name}} {{fields.city}} {{vars.code}}')).toEqual([])
    expect(variableProblems('No variables here 🎉')).toEqual([])
  })

  it('flags a missing closing brace, the typo that reached a customer', () => {
    expect(variableProblems('Here you go! 🎉{{username}')).toHaveLength(1)
  })

  it('flags a missing opening brace, an unfinished opener and single braces', () => {
    expect(variableProblems('{username}}')).toHaveLength(1)
    expect(variableProblems('Hi {{first_name')).toHaveLength(1)
    expect(variableProblems('Hi {first_name}')).toHaveLength(1)
  })

  it('flags unknown variable names', () => {
    expect(variableProblems('Hi {{firstname}}')).toEqual(["{{firstname}} isn't a variable we know, so it will be sent blank."])
  })

  it('reports each kind once per message', () => {
    expect(variableProblems('{{nope}} {{username}')).toHaveLength(2)
  })
})
