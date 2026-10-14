'use client'

import { useState } from 'react'
import { CopyResult, Field, Segmented, toolField } from '@/components/tools/shared'
import { buildUtmUrl, type UtmField, type UtmParams } from '@/lib/tools/utm'

const PRESETS = {
  bio: { source: 'instagram', medium: 'bio' },
  story: { source: 'instagram', medium: 'story' },
  dm: { source: 'instagram', medium: 'dm' },
  facebook: { source: 'facebook', medium: 'social' },
} satisfies Record<string, UtmParams>
type Preset = keyof typeof PRESETS

const FIELDS: { key: UtmField; label: string; placeholder: string; hint: string }[] = [
  { key: 'source', label: 'Source (required)', placeholder: 'instagram', hint: 'Where the visit comes from.' },
  { key: 'medium', label: 'Medium', placeholder: 'dm', hint: 'The placement: bio, story, dm, social.' },
  { key: 'campaign', label: 'Campaign', placeholder: 'free-guide', hint: 'What you are promoting.' },
  { key: 'content', label: 'Content', placeholder: 'reel-oct-14', hint: 'Optional: which post or button.' },
  { key: 'term', label: 'Term', placeholder: '', hint: 'Optional: rarely needed outside paid search.' },
]

export function UtmTool() {
  const [url, setUrl] = useState('')
  const [params, setParams] = useState<UtmParams>(PRESETS.dm)
  const result = url.trim() ? buildUtmUrl(url, params) : null
  // A preset only sets source and medium, so it stays selected while those match.
  const preset = (Object.keys(PRESETS) as Preset[]).find((key) => PRESETS[key].source === params.source && PRESETS[key].medium === params.medium) ?? null
  const usePreset = (key: Preset) => setParams((current) => ({ ...current, ...PRESETS[key] }))

  return (
    <div className="flex flex-col gap-5">
      <Field label="Website link" hint={result?.ok === false && result.error === 'url' ? 'Enter a web address, like example.com/guide.' : undefined}>
        {(id) => (
          <input
            id={id}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/guide"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={result?.ok === false && result.error === 'url'}
            className={toolField}
          />
        )}
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold">Start from</span>
        <Segmented
          label="Start from"
          value={preset}
          onChange={usePreset}
          options={[
            { value: 'bio', label: 'Instagram bio' },
            { value: 'story', label: 'Story' },
            { value: 'dm', label: 'DM' },
            { value: 'facebook', label: 'Facebook' },
          ]}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <Field key={field.key} label={field.label} hint={field.key === 'source' && result?.ok === false && result.error === 'source' ? 'Add a source.' : field.hint}>
            {(id) => (
              <input
                id={id}
                value={params[field.key] ?? ''}
                onChange={(e) => setParams((current) => ({ ...current, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                className={toolField}
              />
            )}
          </Field>
        ))}
      </div>
      <CopyResult label="Tagged link" value={result?.ok ? result.url : null} placeholder="Add a link to see it tagged" />
    </div>
  )
}
