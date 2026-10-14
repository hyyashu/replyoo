'use client'

import { useState } from 'react'
import { CopyResult, Field, Segmented, toolField } from '@/components/tools/shared'
import { REPLY_FIELDS, REPLY_SCENARIO_KEYS, REPLY_SCENARIOS, REPLY_TONES, generateReplies, type ReplyField, type ReplyScenarioKey, type ReplyTone } from '@/lib/tools/dm-replies'

export function DmReplyTool() {
  const [scenario, setScenario] = useState<ReplyScenarioKey>('price')
  const [tone, setTone] = useState<ReplyTone>('friendly')
  const [values, setValues] = useState<Partial<Record<ReplyField, string>>>({})
  const { fields, example } = REPLY_SCENARIOS[scenario]
  const replies = generateReplies(scenario, tone, values)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold">What did they message you about?</span>
        <Segmented
          label="What did they message you about?"
          value={scenario}
          onChange={setScenario}
          options={REPLY_SCENARIO_KEYS.map((key) => ({ value: key, label: REPLY_SCENARIOS[key].label }))}
        />
        <p className="text-[12.5px] text-subtle">For example: “{example}”</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold">Tone</span>
        <Segmented label="Tone" value={tone} onChange={setTone} options={REPLY_TONES} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <Field key={field} label={REPLY_FIELDS[field].label}>
            {(id) => (
              <input
                id={id}
                value={values[field] ?? ''}
                onChange={(e) => setValues((current) => ({ ...current, [field]: e.target.value }))}
                placeholder={REPLY_FIELDS[field].placeholder}
                autoComplete="off"
                inputMode={field === 'link' ? 'url' : undefined}
                className={toolField}
              />
            )}
          </Field>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        {replies.map((reply, index) => (
          <CopyResult key={index} label={`Reply ${index + 1}`} value={reply} placeholder="" text />
        ))}
      </div>
    </div>
  )
}
