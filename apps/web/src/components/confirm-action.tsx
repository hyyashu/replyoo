'use client'

import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal, useFormStatus } from 'react-dom'
import { buttonClass } from '@/components/ui'

const PILL = 'inline-flex h-8 items-center justify-center rounded-full px-3 text-[13px] font-semibold whitespace-nowrap transition-colors'
const DANGER_OUTLINE = `${PILL} border border-[#c2330e] bg-white text-[#c2330e] hover:bg-[#fff4ef]`
const DANGER_SOLID = `${PILL} bg-[#c2330e] text-white hover:bg-[#a52a0a] disabled:pointer-events-none disabled:opacity-50`

function ConfirmSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className={DANGER_SOLID}>
      {pending ? 'Working…' : label}
    </button>
  )
}

/** Modal that asks for confirmation before running `action`. Controlled, so any trigger can open it. */
export function ConfirmDialog({
  open,
  onClose,
  action,
  title,
  description,
  confirmLabel,
}: {
  open: boolean
  onClose: () => void
  action: () => Promise<void>
  title: string
  description: string
  confirmLabel: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="alertdialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full max-w-[420px] rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[16px] font-semibold">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-sand"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-2 text-[13.5px] text-muted">{description}</p>
        <form action={action} className="mt-5 flex justify-end gap-2">
          <button type="button" autoFocus onClick={onClose} className={buttonClass('secondary', 'sm')}>
            Cancel
          </button>
          <ConfirmSubmit label={confirmLabel} />
        </form>
      </div>
    </div>,
    document.body,
  )
}

/** A red-outlined button that asks for confirmation in a dialog before running a server action. */
export function ConfirmAction({
  action,
  label,
  title,
  description,
  confirmLabel = label,
}: {
  action: () => Promise<void>
  label: string
  title: string
  description: string
  confirmLabel?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={DANGER_OUTLINE}>
        {label}
      </button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        action={action}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
      />
    </>
  )
}
