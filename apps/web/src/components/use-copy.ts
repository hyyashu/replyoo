'use client'

import { useEffect, useRef, useState } from 'react'

/** Copies text to the clipboard. `copied` is true for `resetMs` after a copy; `copy` resolves false when the browser refused. */
export function useCopy(resetMs = 1500) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return false
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), resetMs)
    return true
  }
  return { copied, copy }
}
