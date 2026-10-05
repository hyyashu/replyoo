import Link from 'next/link'
import { Logo } from '@/components/ui'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen bg-sand lg:grid-cols-2">
      <div className="flex flex-col px-8 py-8 sm:px-14">
        <Link href="/">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-12">{children}</div>
      </div>
      <div className="relative hidden overflow-hidden bg-ink p-14 text-white lg:flex lg:flex-col lg:justify-end">
        <div className="absolute -top-24 -right-24 size-[420px] rounded-full bg-brand/90 blur-[2px]" />
        <div className="absolute top-40 right-40 size-40 rounded-full bg-lime" />
        <blockquote className="relative max-w-md font-display text-[30px] leading-[1.15] font-bold tracking-[-0.03em]">
          “I post a reel, people comment ‘GUIDE’, and by morning I’ve got 900 new emails.”
        </blockquote>
        <p className="relative mt-4 text-[14px] text-white/60">Maya Lopez · @maya.makes · 412K followers</p>
      </div>
    </div>
  )
}
