import { Skeleton } from "@even/ui/components/skeleton"
import { SidebarSkeletonRows, SidebarSkeletonSection } from "@even/ui/components/sidebar-skeleton"
import { cn } from "@even/ui/lib/utils"
import { Brand } from "@/components/brand"
import { EmptyPaneView } from "@/components/empty-pane"
import { useI18n } from "@/i18n"

/** Lines while a list loads, inset like the lines that follow: drafts flush, mail and parcels past the gutter. */
export function ListSkeleton({ inset = true }: { inset?: boolean }) {
  return (
    <div aria-hidden="true" className="px-2 pb-2">
      {Array.from({ length: 10 }, (_, index) => (
        <div key={index} className={cn("flex flex-col gap-2 py-3 pr-2.5", inset ? "pl-8" : "pl-2.5")}>
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
      ))}
    </div>
  )
}

/**
 * Even mailen while it loads (the session, access, the mail kept on this device),
 * laid out as the app: the sidebar, the inbox loading, the empty reading pane.
 * The app then takes over with the same list skeleton while the mailboxes come in.
 */
export function MailLoading() {
  const { t } = useI18n()
  return (
    <div
      className="workspace-shell mail-shell max-lg:grid-cols-[minmax(0,1fr)]!"
      role="status"
      aria-label={t.shell.loading}
    >
      <aside className="list-sidebar mail-sidebar max-lg:hidden!" aria-hidden="true">
        <div className="sidebar-full">
          <div className="sidebar-brand-row">
            <Brand />
          </div>
          <div className="list-navigation sidebar-sections">
            <div className="sidebar-top">
              <div className="mb-3">
                <SidebarSkeletonRows rows={1} offset={2} />
              </div>
              <SidebarSkeletonRows rows={8} offset={3} />
            </div>
            <SidebarSkeletonSection heading={t.shell.mailboxes} rows={1} offset={8} />
          </div>
        </div>
      </aside>
      <main className="flex min-h-0 min-w-0" aria-hidden="true">
        <section className="flex min-h-0 w-full shrink-0 flex-col md:w-80 xl:w-96">
          <header className="flex h-14 shrink-0 items-center gap-1.5 pr-2 pl-2 lg:pl-10">
            {/* Where the menu button sits on smaller screens. */}
            <span className="size-7 shrink-0 lg:hidden" />
            <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{t.inbox.title}</h1>
          </header>
          <div className="min-h-0 flex-1 overflow-hidden">
            <ListSkeleton />
          </div>
        </section>
        <section className="floating-panel hidden min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:m-2 md:flex">
          <EmptyPaneView />
        </section>
      </main>
    </div>
  )
}
