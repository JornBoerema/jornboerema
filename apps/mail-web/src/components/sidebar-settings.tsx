import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { DragDropVerticalIcon, ViewIcon, ViewOffSlashIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { SettingsSection } from "@evido/ui/components/settings-dialog"
import { cn } from "@evido/ui/lib/utils"
import { DEFAULT_SIDEBAR, type NavItem, type NavSection, type SidebarLayout } from "@evido/mail-core/sidebar"
import { IconTip } from "@/components/icon-tip"
import { PLACE_ICONS, usePlaceLabels } from "@/components/sidebar"
import { useI18n } from "@/i18n"
import { setSidebar, useInvoices, useParcels, useSenders, useSidebarLayout } from "@/lib/preferences"

/** The section breaks in the one sortable list: what follows each goes under More, or is hidden. */
const MORE = "§more"
const HIDDEN = "§hidden"
type Row = NavItem | typeof MORE | typeof HIDDEN

const rowsOf = (layout: SidebarLayout): Row[] => [...layout.main, MORE, ...layout.more, HIDDEN, ...layout.hidden]

function layoutOf(rows: Row[]): SidebarLayout | null {
  const more = rows.indexOf(MORE)
  const hidden = rows.indexOf(HIDDEN)
  if (more > hidden) return null
  const places = (from: number, to: number) => rows.slice(from, to) as NavItem[]
  const layout = { main: places(0, more), more: places(more + 1, hidden), hidden: places(hidden + 1, rows.length) }
  // The inbox is always a way home.
  return layout.hidden.includes("inbox") ? null : layout
}

const sectionOf = (layout: SidebarLayout, id: NavItem): NavSection =>
  layout.main.includes(id) ? "main" : layout.more.includes(id) ? "more" : "hidden"

function SectionBreak({ id, label, empty, emptyLabel }: { id: Row; label: string; empty: boolean; emptyLabel: string }) {
  // Part of the list, so places can be dropped right after it, but it never moves itself.
  const { setNodeRef, transform, transition } = useSortable({ id, disabled: true })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className="flex flex-col gap-1 pt-5 pb-1.5"
    >
      <span className="px-2 text-xs font-medium text-muted-foreground">{label}</span>
      {empty && (
        <span className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">{emptyLabel}</span>
      )}
    </li>
  )
}

function PlaceRow({
  id,
  label,
  note,
  hidden,
  canHide,
  onToggle,
}: {
  id: NavItem
  label: string
  note?: string
  hidden: boolean
  canHide: boolean
  onToggle: () => void
}) {
  const t = useI18n().t.sidebarSettings
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  const toggleLabel = hidden ? t.show(label) : t.hide(label)
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group relative flex h-10 items-center gap-2.5 rounded-lg bg-background px-1.5 text-sm",
        isDragging ? "z-10 shadow-lg ring-1 ring-border" : "hover:bg-accent/60",
        hidden && !isDragging && "text-muted-foreground"
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-md text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        aria-label={t.move(label)}
        {...attributes}
        {...listeners}
      >
        <HugeiconsIcon icon={DragDropVerticalIcon} strokeWidth={2} aria-hidden="true" className="size-4" />
      </button>
      <HugeiconsIcon icon={PLACE_ICONS[id]} strokeWidth={2} aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {note && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{note}</span>}
      {canHide && (
        <IconTip label={toggleLabel}>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={toggleLabel}
            onClick={onToggle}
          >
            <HugeiconsIcon icon={hidden ? ViewIcon : ViewOffSlashIcon} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </IconTip>
      )}
    </li>
  )
}

/**
 * The sidebar as one list to drag into order. What sits below "More" goes
 * under More; what sits below "Hidden" isn't shown. It follows the account.
 */
export function SidebarSettings() {
  const t = useI18n().t.sidebarSettings
  const labels = usePlaceLabels()
  const layout = useSidebarLayout()
  const parcels = useParcels()
  const invoices = useInvoices()
  const senders = useSenders()
  const rows = rowsOf(layout)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const isDefault = JSON.stringify(layout) === JSON.stringify(DEFAULT_SIDEBAR)

  const featureOff: Partial<Record<NavItem, boolean>> = { parcels: !parcels, invoices: !invoices, senders: !senders }
  const noteFor = (id: NavItem) =>
    featureOff[id] ? t.featureOff : id === "snoozed" || id === "scheduled" ? t.onlyWhenUsed : undefined

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const next = layoutOf(arrayMove(rows, rows.indexOf(active.id as Row), rows.indexOf(over.id as Row)))
    if (next) setSidebar(next)
  }
  // Hiding goes to the end of Hidden; showing again goes back to the end of the sidebar.
  const toggle = (id: NavItem) => {
    const hidden = sectionOf(layout, id) === "hidden"
    const without = (list: NavItem[]) => list.filter((item) => item !== id)
    setSidebar({
      main: hidden ? [...without(layout.main), id] : without(layout.main),
      more: without(layout.more),
      hidden: hidden ? without(layout.hidden) : [...without(layout.hidden), id],
    })
  }

  return (
    <SettingsSection title={t.title} description={t.description}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={onDragEnd}
        accessibility={{ screenReaderInstructions: { draggable: t.dragHelp } }}
      >
        <SortableContext items={rows} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-0.5">
            <li className="px-2 pb-1.5 text-xs font-medium text-muted-foreground">{t.inSidebar}</li>
            {rows.map((row) =>
              row === MORE ? (
                <SectionBreak key={row} id={row} label={t.underMore} empty={!layout.more.length} emptyLabel={t.dropHere} />
              ) : row === HIDDEN ? (
                <SectionBreak
                  key={row}
                  id={row}
                  label={t.hidden}
                  empty={!layout.hidden.length}
                  emptyLabel={t.dropHere}
                />
              ) : (
                <PlaceRow
                  key={row}
                  id={row}
                  label={labels[row]}
                  note={noteFor(row)}
                  hidden={sectionOf(layout, row) === "hidden"}
                  canHide={row !== "inbox"}
                  onToggle={() => toggle(row)}
                />
              )
            )}
          </ul>
        </SortableContext>
      </DndContext>
      {!isDefault && (
        <div>
          <Button variant="outline" onClick={() => setSidebar(null)}>
            {t.reset}
          </Button>
        </div>
      )}
    </SettingsSection>
  )
}
