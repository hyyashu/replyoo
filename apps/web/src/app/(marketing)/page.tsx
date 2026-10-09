import { PLAN_LIMITS } from '@replyooo/shared'
import type { Metadata } from 'next'
import { ArrowRight, AtSign, MessageCircleReply, MessagesSquare, Sparkles, UserPlus, Zap } from 'lucide-react'
import { InstagramIcon } from '@/components/brand-icons'
import { JsonLd } from '@/components/json-ld'
import { MarketingFooter, MarketingHeader, PricingCards } from '@/components/marketing'
import { PhonePreview } from '@/components/phone-preview'
import { ButtonLink, Keyword, cx } from '@/components/ui'
import { DEFAULT_RECIPE, type Recipe } from '@/lib/recipe'
import { freePlan, graph, organizationLd, softwareApplicationLd, websiteLd } from '@/lib/structured-data'

const FREE_CONTACTS = PLAN_LIMITS.free.contactsPerMonth.toLocaleString('en-US')

const TITLE = 'Instagram comment-to-DM automation for creators'
const DESCRIPTION = `Reply to every Instagram comment, story reply and DM in seconds. Send your link, ask for a follow before it unlocks, and collect emails in the chat. Free for ${FREE_CONTACTS} contacts a month.`

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/' },
}

const HERO_RECIPE: Recipe = {
  ...DEFAULT_RECIPE,
  trigger: {
    type: 'comment_keyword',
    posts: { mode: 'any' },
    keywords: ['GUIDE'],
    match: 'contains',
    publicReplies: { enabled: true, replies: ['Sent! Check your DMs ✨'] },
  },
  opener: { enabled: true, text: 'Hey {{first_name}}! Want my 7-day meal plan? Tap below 👇', buttonLabel: 'Send it to me' },
  followGate: { ...DEFAULT_RECIPE.followGate, enabled: false },
  collect: { ...DEFAULT_RECIPE.collect, kind: 'none' },
  message: {
    text: "Here you go! 🎉 Save it so you don't lose it.",
    imageUrl: '',
    links: [{ label: 'Get the guide', url: 'https://mayamakes.co/7day' }],
  },
}

const STEPS = [
  {
    title: 'Connect Instagram',
    body: 'One click through Meta’s official API. We never see your password.',
    className: 'bg-violet-soft',
    visual: (
      <span className="inline-flex items-center gap-2 rounded-full bg-[linear-gradient(90deg,#6b4bff,#ff4f1f)] px-4 py-2 text-[13px] font-semibold text-white">
        <InstagramIcon className="size-4" /> Continue with Instagram
      </span>
    ),
  },
  {
    title: 'Pick your keyword',
    body: 'Choose the word fans comment — on one reel, every post, or your stories.',
    className: 'bg-lime-soft',
    visual: (
      <span className="flex gap-1.5">
        <Keyword>GUIDE</Keyword>
        <Keyword>LINK</Keyword>
        <Keyword>PRICE</Keyword>
      </span>
    ),
  },
  {
    title: 'Write the DM once',
    body: 'Add your link, a follow gate or an email ask. Replyooo sends it forever.',
    className: 'bg-sky-soft',
    visual: (
      <span className="rounded-2xl bg-violet px-3.5 py-2 text-[13px] text-white">Hey Sam! Here’s your guide 👇</span>
    ),
  },
]

const FEATURES = [
  {
    icon: MessageCircleReply,
    eyebrow: 'Comment → DM',
    title: 'Every comment gets your link — in under a second',
    body: 'Reply publicly and slide into their DMs at the same time. Works on reels, posts and carousels.',
    className: 'bg-brand-soft lg:col-span-2',
  },
  {
    icon: UserPlus,
    eyebrow: 'Follow gate',
    title: 'Turn freebies into followers',
    body: 'Ask for a follow before the link unlocks. Replyooo checks it automatically.',
    className: 'bg-sand',
  },
  {
    icon: AtSign,
    eyebrow: 'Lead capture',
    title: 'Build your email list in the DM',
    body: 'Ask for an email or phone number, validate it, and keep every lead in one place.',
    className: 'bg-sand',
  },
  {
    icon: Sparkles,
    eyebrow: 'Story replies',
    title: 'Every story reply becomes a conversation',
    body: 'React or reply to a story and get an instant, personal answer.',
    className: 'bg-violet-soft',
  },
  {
    icon: MessagesSquare,
    eyebrow: 'Conversation starters',
    title: 'Answer the questions you get every day',
    body: 'Tappable questions in every new chat — pricing, shipping, booking — answered instantly.',
    className: 'bg-ink text-white',
  },
]

export default function LandingPage() {
  return (
    <div className="bg-sand">
      <JsonLd data={graph(organizationLd, websiteLd, softwareApplicationLd(freePlan))} />
      <MarketingHeader />

      <section className="mx-auto grid max-w-[1200px] items-center gap-12 px-6 pt-10 pb-20 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <span className="eyebrow inline-flex items-center gap-2 text-ink-2">
            <span className="size-1.5 rounded-full bg-brand" /> Instagram & Facebook DM automation for creators
          </span>
          <h1 className="mt-5 font-display text-[64px] leading-[0.95] font-extrabold tracking-[-0.05em] sm:text-[80px]">
            Turn every comment into a{' '}
            <span className="inline-block -rotate-1 rounded-2xl bg-lime px-3">customer.</span>
          </h1>
          <p className="mt-6 max-w-[480px] text-[17px] leading-relaxed text-muted">
            Replyooo answers every comment, story reply and DM in seconds — sends your link, grows your followers, and
            collects emails while you’re busy creating.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/signup" className="h-12 px-6 text-[15px]">
              Start free — no card needed <ArrowRight className="size-4" />
            </ButtonLink>
            <ButtonLink href="#how" variant="secondary" className="h-12 border-ink px-6 text-[15px]">
              See how it works
            </ButtonLink>
          </div>
        </div>

        <div className="relative rounded-[32px] bg-[linear-gradient(160deg,#ffd7c4,#ffb59a)] px-6 py-10">
          <div className="absolute top-14 -left-6 hidden rotate-[-4deg] rounded-2xl bg-white p-3 shadow-[0_12px_32px_rgba(21,19,16,0.12)] sm:block">
            <div className="text-[12px] font-semibold">sam.eats · GUIDE 🙌</div>
            <div className="mt-1 text-[11px] text-subtle">↳ Sent! Check your DMs ✨</div>
          </div>
          <div className="absolute -right-3 bottom-16 hidden rotate-[3deg] items-center gap-2 rounded-2xl bg-ink px-4 py-3 text-white shadow-[0_12px_32px_rgba(21,19,16,0.2)] sm:flex">
            <Zap className="size-4 text-lime" />
            <span className="text-[13px] font-semibold">Replied in 0.8s</span>
          </div>
          <div className="scale-[0.92]">
            <PhonePreview recipe={HERO_RECIPE} mode="dm" username="maya.makes" />
          </div>
        </div>
      </section>

      <section id="how" className="bg-white py-24">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <h2 className="font-display text-[44px] leading-[1.02] font-bold tracking-[-0.04em]">
              Live in 3 minutes.
              <br />
              Then it runs itself.
            </h2>
            <p className="max-w-sm text-[15px] text-muted">
              No flowcharts, no coding, no “bot builder” to learn. If you can write a caption, you can set up Replyooo.
            </p>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <div key={step.title} className={cx('rounded-[24px] p-6', step.className)}>
                <div className="grid h-36 place-items-center rounded-2xl bg-white/70">{step.visual}</div>
                <div className="eyebrow mt-6">Step 0{index + 1}</div>
                <h3 className="mt-1 text-[18px] font-semibold">{step.title}</h3>
                <p className="mt-1 text-[14px] text-muted">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="py-24">
        <div className="mx-auto max-w-[1200px] px-6">
          <h2 className="mx-auto max-w-xl text-center font-display text-[44px] leading-[1.02] font-bold tracking-[-0.04em]">
            Everything between a comment and a sale.
          </h2>
          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {FEATURES.map((feature) => {
              const Icon = feature.icon
              const dark = feature.className.includes('bg-ink')
              return (
                <div key={feature.title} className={cx('flex min-h-[240px] flex-col rounded-[24px] p-7', feature.className)}>
                  <span className={cx('grid size-11 place-items-center rounded-2xl', dark ? 'bg-lime text-ink' : 'bg-white text-ink')}>
                    <Icon className="size-5" />
                  </span>
                  <div className={cx('eyebrow mt-auto pt-8', dark ? 'text-lime' : 'text-brand')}>{feature.eyebrow}</div>
                  <h3 className="mt-1.5 text-[19px] leading-snug font-semibold">{feature.title}</h3>
                  <p className={cx('mt-1.5 text-[14px]', dark ? 'text-white/60' : 'text-muted')}>{feature.body}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section id="pricing" className="bg-white py-24">
        <div className="mx-auto max-w-[1200px] px-6 text-center">
          <span className="eyebrow inline-flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-brand" /> Pricing
          </span>
          <h2 className="mt-3 font-display text-[44px] leading-tight font-bold tracking-[-0.04em]">Free until it’s working.</h2>
          <p className="mt-2 text-[15px] text-muted">Start with {FREE_CONTACTS} contacts a month on us. Upgrade when your comments outgrow it.</p>
          <PricingCards />
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-[1200px] rounded-[32px] bg-brand px-8 py-20 text-center text-white">
          <h2 className="mx-auto max-w-2xl font-display text-[52px] leading-[1] font-extrabold tracking-[-0.05em]">
            Your next reel could reply to itself.
          </h2>
          <p className="mt-4 text-[16px] text-white/80">Set up your first automation in 3 minutes. Free forever for {FREE_CONTACTS} contacts.</p>
          <div className="mt-8 flex justify-center gap-3">
            <ButtonLink href="/signup" variant="dark" className="h-12 px-6">
              Start free <ArrowRight className="size-4" />
            </ButtonLink>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
