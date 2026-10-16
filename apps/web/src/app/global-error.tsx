'use client'

import { Button, Logo } from '@/components/ui'
import './globals.css'

// Replaces the root layout when it fails, so there are no fonts or translations here: plain English, like not-found.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <div role="alert" className="grid min-h-screen place-items-center bg-sand px-6 text-center">
          <div>
            <Logo />
            <h1 className="mt-8 font-display text-[40px] font-bold tracking-[-0.04em]">Something went wrong.</h1>
            <p className="mt-2 text-[15px] text-muted">Try again in a moment.{error.digest ? ` (ref ${error.digest})` : ''}</p>
            <Button className="mt-6" onClick={reset}>
              Try again
            </Button>
          </div>
        </div>
      </body>
    </html>
  )
}
