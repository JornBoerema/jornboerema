import { SkeletonLine } from "@even/ui/components/skeleton"
import { SidebarSkeletonSection } from "@even/ui/components/sidebar-skeleton"
import { cn } from "@even/ui/lib/utils"
import { Brand } from "@/components/brand"
import { useI18n } from "@/i18n"

/** Paragraphs of a note, as long as lines of 15px text (line-height 1.8) run. */
const PARAGRAPHS = [
  ["w-full", "w-11/12", "w-2/3"],
  ["w-full", "w-4/5"],
  ["w-11/12", "w-full", "w-1/2"],
]

/** A note's text while it loads: a few paragraphs, line for line where the text will be. */
export function NoteBodyLoading() {
  return (
    <div className="flex flex-col gap-3 pt-2.5" aria-hidden="true">
      {PARAGRAPHS.map((lines, paragraph) => (
        <div key={paragraph}>
          {lines.map((width, index) => (
            <SkeletonLine key={index} className="h-[27px]" bar={width} />
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * Even noteren while it loads, laid out as it will be: the sidebar with the notes
 * and the first note. Every step of loading (session, organization, workspace)
 * shows this same screen, so nothing jumps between them. A shared note has no sidebar.
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
            <SidebarSkeletonSection heading={t.workspace.sidebar.notes} rows={5} />
          </div>
        </aside>
      )}
      <main className="workspace-main">
        <div className="task-content note-content" aria-hidden="true">
          <div className="task-heading">
            <div className="min-w-0 flex-1">
              <SkeletonLine className="h-[36px]" bar="h-7 w-56" />
            </div>
          </div>
          <NoteBodyLoading />
        </div>
      </main>
    </div>
  )
}
