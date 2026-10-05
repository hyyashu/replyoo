import { ButtonLink, Logo } from '@/components/ui'

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-sand px-6 text-center">
      <div>
        <Logo />
        <h1 className="mt-8 font-display text-[40px] font-bold tracking-[-0.04em]">Nothing here.</h1>
        <p className="mt-2 text-[15px] text-muted">That page doesn’t exist (yet).</p>
        <ButtonLink href="/" className="mt-6">
          Back home
        </ButtonLink>
      </div>
    </div>
  )
}
