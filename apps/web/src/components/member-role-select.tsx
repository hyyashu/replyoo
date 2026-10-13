'use client'

import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'
import { changeMemberRole } from '@/app/actions'

export function MemberRoleSelect({ memberId, name, role }: { memberId: string; name: string; role: 'admin' | 'member' }) {
  const tr = useTranslations('settings')
  const common = useTranslations('common')
  const [pending, startTransition] = useTransition()
  const [failed, setFailed] = useState(false)
  return (
    <select
      aria-label={tr('change_role_for', { v0: name })}
      value={role}
      disabled={pending}
      aria-busy={pending}
      aria-invalid={failed}
      onChange={(event) => {
        const value = event.target.value
        setFailed(false)
        startTransition(async () => {
          try {
            await changeMemberRole(memberId, value)
          } catch {
            setFailed(true)
          }
        })
      }}
      className="h-8 rounded-full border border-line bg-white px-3 text-[12px] font-medium disabled:opacity-50"
    >
      <option value="member">{common('role_member')}</option>
      <option value="admin">{common('role_admin')}</option>
    </select>
  )
}
