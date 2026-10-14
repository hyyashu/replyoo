'use client'

import { useState } from 'react'
import { CopyResult, Field, Segmented, toolField } from '@/components/tools/shared'
import { cleanHandle, dmLink, type DmPlatform } from '@/lib/tools/dm-link'

export function DmLinkTool() {
  const [platform, setPlatform] = useState<DmPlatform>('instagram')
  const [handle, setHandle] = useState('')
  const link = dmLink(platform, handle)
  const invalid = handle.trim() !== '' && !link

  return (
    <div className="flex flex-col gap-5">
      <Segmented
        label="Platform"
        value={platform}
        onChange={setPlatform}
        options={[
          { value: 'instagram', label: 'Instagram' },
          { value: 'facebook', label: 'Facebook Page' },
        ]}
      />
      <Field
        label={platform === 'instagram' ? 'Instagram username' : 'Facebook Page username'}
        hint={
          invalid
            ? platform === 'instagram'
              ? `“${cleanHandle(handle)}” isn’t a valid Instagram username: up to 30 letters, numbers, periods and underscores.`
              : `“${cleanHandle(handle)}” isn’t a valid Page username: at least 5 letters, numbers and periods.`
            : 'You can paste an @handle or a profile link.'
        }
      >
        {(id) => (
          <input
            id={id}
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder={platform === 'instagram' ? 'maya.makes' : 'mayamakes'}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={invalid}
            className={toolField}
          />
        )}
      </Field>
      <CopyResult label="Your DM link" value={link} placeholder={platform === 'instagram' ? 'https://ig.me/m/…' : 'https://m.me/…'} />
      {link && (
        <a href={link} target="_blank" rel="noopener noreferrer" className="self-start text-[13.5px] font-semibold underline">
          Open it to test
        </a>
      )}
    </div>
  )
}
