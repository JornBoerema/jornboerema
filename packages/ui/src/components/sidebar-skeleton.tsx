import { Skeleton } from "./skeleton"

/** Varied but fixed, so names look like names and the same rows come back each time. */
const WIDTHS = ["w-28", "w-20", "w-32", "w-24", "w-16", "w-28", "w-20", "w-24", "w-32", "w-16"]

/**
 * Rows of the shared sidebar (.list-link) while they load: an icon and a name,
 * exactly as tall as the links that take their place.
 */
export function SidebarSkeletonRows({ rows, offset = 0 }: { rows: number; offset?: number }) {
  return (
    <div className="sidebar-section-links" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="list-link pointer-events-none">
          <Skeleton className="size-4 shrink-0 rounded-[5px]" />
          <Skeleton className={`h-3.5 ${WIDTHS[(index + offset) % WIDTHS.length]}`} />
        </div>
      ))}
    </div>
  )
}

/** A sidebar section while it loads: its heading as it will be, its rows still coming. */
export function SidebarSkeletonSection({
  heading,
  rows,
  offset,
}: {
  heading: string
  rows: number
  offset?: number
}) {
  return (
    <section className="sidebar-list-section">
      <div className="sidebar-heading">
        <h2>{heading}</h2>
      </div>
      <SidebarSkeletonRows rows={rows} offset={offset} />
    </section>
  )
}
