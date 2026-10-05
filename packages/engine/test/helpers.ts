import type { FlowDefinition } from '@replyooo/shared'
import { advance, newRunState } from '../src'
import type { AdvanceResult, ContactState, Effect, EngineEvent, FlowRunState } from '../src'

export const T0 = new Date('2026-01-01T00:00:00.000Z')

export const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000)

export function makeContact(overrides: Partial<ContactState> = {}): ContactState {
  return {
    username: 'priya',
    name: 'Priya Sharma',
    email: null,
    phone: null,
    tags: [],
    fields: {},
    ...overrides,
  }
}

export function dmFlow(steps: FlowDefinition['steps'], start = 's1'): FlowDefinition {
  return { trigger: { type: 'any_dm' }, start, steps }
}

/** Stateful test driver: keeps run + contact between events and applies contact patches. */
export class Driver {
  run: FlowRunState = newRunState()
  effects: Effect[] = []
  now: Date = T0

  constructor(
    readonly flow: FlowDefinition,
    public contact: ContactState = makeContact(),
  ) {}

  send(event: EngineEvent): AdvanceResult {
    const result = advance({
      run: this.run,
      flow: this.flow,
      contact: this.contact,
      event,
      now: this.now,
      random: () => 0,
    })
    this.effects = result.effects
    if (!result.ignored) {
      this.run = result.run
      for (const effect of result.effects) {
        if (effect.type === 'update_contact') this.applyPatch(effect.patch)
      }
    }
    return result
  }

  startDm(text = 'hi') {
    return this.send({ type: 'start', trigger: { kind: 'dm', text } })
  }

  startComment(commentId = 'c1', text = 'GUIDE') {
    return this.send({ type: 'start', trigger: { kind: 'comment', commentId, text } })
  }

  tick(minutes: number) {
    this.now = addMinutes(this.now, minutes)
  }

  /** Texts of all messages (send + private_reply) in the last result. */
  sentTexts(): string[] {
    return this.effects.flatMap((effect) =>
      effect.type === 'send' || effect.type === 'private_reply' ? [effect.message.text] : [],
    )
  }

  private applyPatch(patch: NonNullable<Extract<Effect, { type: 'update_contact' }>['patch']>) {
    const remove = patch.removeTags ?? []
    this.contact = {
      ...this.contact,
      ...(patch.email !== undefined ? { email: patch.email } : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      fields: { ...this.contact.fields, ...(patch.fields ?? {}) },
      tags: [...new Set([...this.contact.tags.filter((t) => !remove.includes(t)), ...(patch.addTags ?? [])])],
    }
  }
}
