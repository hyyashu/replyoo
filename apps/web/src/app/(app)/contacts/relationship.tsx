import { useTranslations } from 'next-intl'
import { cx } from '@/components/ui'

const badge = 'inline-flex h-6 items-center rounded-full border px-2.5 text-[12px] font-medium'

/** "You follow" / "Follows you" chips. Empty when Instagram hasn't told us either way. */
export function RelationshipBadges({
  followsYou,
  youFollow,
  className,
}: {
  followsYou: boolean | null
  youFollow: boolean | null
  className?: string
}) {
  const tr = useTranslations('contacts')
  if (!followsYou && !youFollow) return <span className="text-faint">—</span>
  return (
    <span className={cx('flex flex-wrap gap-1', className)}>
      {youFollow && <span className={cx(badge, 'border-line bg-sand text-muted')}>{tr('you_follow')}</span>}
      {followsYou && <span className={cx(badge, 'border-lime-ink/20 bg-lime-soft text-lime-ink')}>{tr('follows_you')}</span>}
    </span>
  )
}
