import { Check } from 'lucide-react'
import { switchWorkspace } from '@/app/actions'
import { Card, buttonClass } from '@/components/ui'
import type { WorkspaceSummary } from '@/lib/workspaces'

/** The workspaces the user belongs to, with a Switch button for every one but the current. */
export function WorkspaceList({ workspaces, currentId }: { workspaces: WorkspaceSummary[]; currentId: string }) {
  return (
    <Card className="divide-y divide-line text-left">
      {workspaces.map((w) => (
        <div key={w.id} className="flex items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold">{w.name}</div>
            <div className="text-[12.5px] capitalize text-subtle">{w.role}</div>
          </div>
          {w.id === currentId ? (
            <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-green">
              <Check className="size-3.5" /> Current
            </span>
          ) : (
            <form action={switchWorkspace.bind(null, w.id)}>
              <button type="submit" className={buttonClass('secondary', 'sm')}>
                Switch
              </button>
            </form>
          )}
        </div>
      ))}
    </Card>
  )
}
