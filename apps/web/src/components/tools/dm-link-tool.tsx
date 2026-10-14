'use client'

import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CopyResult, Field, Segmented, toolField } from '@/components/tools/shared'
import { Button } from '@/components/ui'
import { cleanHandle, dmLink, type DmPlatform } from '@/lib/tools/dm-link'
import { qrSvg } from '@/lib/tools/qr'

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
      {link && <QrCode link={link} name={cleanHandle(handle)} />}
    </div>
  )
}

const PNG_SIZE = 1024

function QrCode({ link, name }: { link: string; name: string }) {
  const svg = useMemo(() => qrSvg(link), [link])
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  const filename = `dm-link-${name}`

  const save = (href: string, ext: string) => {
    const a = document.createElement('a')
    a.href = href
    a.download = `${filename}.${ext}`
    a.click()
  }

  const savePng = () => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = PNG_SIZE
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, 0, 0, PNG_SIZE, PNG_SIZE)
      save(canvas.toDataURL('image/png'), 'png')
    }
    img.src = src
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-sand p-4 sm:flex-row sm:items-center">
      {/* eslint-disable-next-line @next/next/no-img-element -- a generated data URL, nothing for next/image to optimise */}
      <img src={src} alt={`QR code that opens ${link}`} width={160} height={160} className="size-40 shrink-0 rounded-xl" />
      <div className="flex flex-col gap-3">
        <div>
          <div className="eyebrow">QR code</div>
          <p className="mt-1.5 text-[13.5px] text-subtle">Scanning it opens the same DM. Print it on a flyer, menu, packaging or business card.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="dark" size="sm" onClick={savePng}>
            <Download className="size-3.5" /> PNG
          </Button>
          <Button variant="secondary" size="sm" onClick={() => save(src, 'svg')}>
            <Download className="size-3.5" /> SVG
          </Button>
        </div>
      </div>
    </div>
  )
}
