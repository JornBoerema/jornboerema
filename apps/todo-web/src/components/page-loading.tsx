import { Skeleton, SkeletonLine } from "@even/ui/components/skeleton"
import { SidebarSkeletonSection } from "@even/ui/components/sidebar-skeleton"
import { cn } from "@even/ui/lib/utils"
import { Brand } from "@/components/brand"
import { useI18n } from "@/i18n"

const TASK_WIDTHS = ["w-3/5", "w-2/5", "w-1/2", "w-3/4", "w-1/3", "w-2/5"]

/** A list while it loads: its name, the field to add a task, and rows as tall as tasks. */
export function ListLoading() {
  return (
    <div className="task-content" aria-hidden="true">
      <div className="task-heading">
        <div className="min-w-0 flex-1">
          <SkeletonLine className="h-[36px]" bar="h-7 w-48" />
          <SkeletonLine className="mt-2 h-[19px]" bar="h-3 w-24" />
        </div>
      </div>
      <div className="task-composer">
        <div className="h-12 w-full rounded-md bg-input/50" />
      </div>
      <div className="flex flex-col">
        {TASK_WIDTHS.map((width, index) => (
          <div key={index} className="todo-row">
            <Skeleton className="ml-1 size-[18px] shrink-0 rounded-[4px]" />
            <Skeleton className={cn("h-3.5", width)} />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Even doen while it loads, laid out as it will be: the sidebar with its sections
 * and the first list. Every step of loading (session, organization, workspace)
 * shows this same screen, so nothing jumps between them. A shared list has no sidebar.
 */
export function PageLoading({ shared = false }: { shared?: boolean }) {
  const { t } = useI18n()
  return (
    <div
      className={cn("workspace-shell", shared && "shared-workspace")}
      role="status"
      aria-label={t.common.loading}
    >
      {!shared && (
        <aside className="list-sidebar" aria-hidden="true">
          <div className="sidebar-brand-row">
            <Brand />
          </div>
          <div className="list-navigation sidebar-sections">
            <div className="sidebar-top" />
            <SidebarSkeletonSection heading={t.workspace.sidebar.lists} rows={4} />
            <SidebarSkeletonSection heading={t.board.sidebar.boards} rows={2} offset={4} />
          </div>
        </aside>
      )}
      <main className="workspace-main">
        <ListLoading />
      </main>
    </div>
  )
}
