import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
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
import { ArrowDown01Icon, DragDropVerticalIcon, ViewIcon, ViewOffSlashIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { cn } from "@evido/ui/lib/utils"
import { DEFAULT_SIDEBAR, type NavItem, type SidebarLayout } from "@evido/mail-core/sidebar"
import { useI18n } from "@/i18n"
import { setSidebar, useSidebarLayout } from "@/lib/preferences"

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

const NAV_ICON = "size-4 shrink-0"

/** "More" and "Hidden": where a section starts. Places drop right after it; it never moves itself. */
function SectionBreak({ id, icon, label }: { id: Row; icon: IconSvgElement; label: string }) {
  const { setNodeRef, transform, transition } = useSortable({ id, disabled: true })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className="list-link is-ghost pointer-events-none mt-2"
    >
      <HugeiconsIcon icon={icon} strokeWidth={2} className={NAV_ICON} aria-hidden="true" />
      <span>{label}</span>
    </li>
  )
}

function PlaceRow({
  id,
  icon,
  label,
  hidden,
  canHide,
  onToggle,
}: {
  id: NavItem
  icon: IconSvgElement
  label: string
  hidden: boolean
  canHide: boolean
  onToggle: () => void
}) {
  const t = useI18n().t.sidebarEditor
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const toggleLabel = hidden ? t.show(label) : t.hide(label)
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "list-link group relative cursor-grab touch-none active:cursor-grabbing",
        isDragging && "z-10 bg-sidebar shadow-lg ring-1 ring-border",
        hidden && !isDragging && "text-muted-foreground"
      )}
      aria-label={t.move(label)}
      {...attributes}
      {...listeners}
    >
      <HugeiconsIcon icon={icon} strokeWidth={2} className={cn(NAV_ICON, hidden && "opacity-50")} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {canHide && (
        <button
          type="button"
          className="-my-1 -mr-1.5 grid size-6 place-items-center rounded-md text-muted-foreground hover:text-foreground"
          aria-label={toggleLabel}
          onClick={onToggle}
          // Not a drag: the eye only hides or shows.
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <HugeiconsIcon icon={hidden ? ViewIcon : ViewOffSlashIcon} strokeWidth={1.75} aria-hidden="true" className="size-3.5" />
        </button>
      )}
      <HugeiconsIcon
        icon={DragDropVerticalIcon}
        strokeWidth={2}
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
      />
    </li>
  )
}

/** How long the bar takes to slide out and the veil to fade. */
const LEAVE_MS = 250

/**
 * The sidebar while it is being arranged: every place in one list to drag,
 * More and Hidden as the breaks between, an eye on each to hide or show it.
 * Nothing changes until it is saved from the bar at the bottom.
 */
export function SidebarEditor({
  icons,
  labels,
  onDone,
}: {
  icons: Record<NavItem, IconSvgElement>
  labels: Record<NavItem, string>
  onDone: () => void
}) {
  const t = useI18n().t.sidebarEditor
  const saved = useSidebarLayout()
  const [draft, setDraft] = useState(saved)
  const rows = rowsOf(draft)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const changed = JSON.stringify(draft) !== JSON.stringify(saved)
  const isDefault = JSON.stringify(draft) === JSON.stringify(DEFAULT_SIDEBAR)
  // Closing first lets the bar slide away and the veil fade, then hands back.
  const [closing, setClosing] = useState(false)
  const close = () => setClosing(true)
  // In place below the screen first, then up: two frames, so the start is painted.
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => setEntered(true))))
    return () => cancelAnimationFrame(frame)
  }, [])
  const shown = entered && !closing
  useEffect(() => {
    if (!closing) return
    const timer = window.setTimeout(onDone, LEAVE_MS)
    return () => window.clearTimeout(timer)
  }, [closing, onDone])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      // A drag in progress takes Escape for itself.
      if (event.key === "Escape" && !document.querySelector("[aria-pressed='true'][aria-roledescription]")) setClosing(true)
    }
    document.addEventListener("keydown", keydown)
    return () => document.removeEventListener("keydown", keydown)
  }, [])

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const next = layoutOf(arrayMove(rows, rows.indexOf(active.id as Row), rows.indexOf(over.id as Row)))
    if (next) setDraft(next)
  }
  // Hiding goes to the end of Hidden; showing again goes back to the end of the sidebar.
  const toggle = (id: NavItem) => {
    const hidden = draft.hidden.includes(id)
    const without = (list: NavItem[]) => list.filter((item) => item !== id)
    setDraft({
      main: hidden ? [...without(draft.main), id] : without(draft.main),
      more: without(draft.more),
      hidden: hidden ? without(draft.hidden) : [...without(draft.hidden), id],
    })
  }
  const save = () => {
    if (changed) setSidebar(isDefault ? null : draft)
    close()
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={onDragEnd}
        accessibility={{ screenReaderInstructions: { draggable: t.dragHelp } }}
      >
        <SortableContext items={rows} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col" aria-label={t.title}>
            {rows.map((row) =>
              row === MORE ? (
                <SectionBreak key={row} id={row} icon={ArrowDown01Icon} label={t.more} />
              ) : row === HIDDEN ? (
                <SectionBreak key={row} id={row} icon={ViewOffSlashIcon} label={t.hidden} />
              ) : (
                <PlaceRow
                  key={row}
                  id={row}
                  icon={icons[row]}
                  label={labels[row]}
                  hidden={draft.hidden.includes(row)}
                  canHide={row !== "inbox"}
                  onToggle={() => toggle(row)}
                />
              )
            )}
          </ul>
        </SortableContext>
      </DndContext>
      {createPortal(
        // Everything but the sidebar and this bar steps back: blurred, dimmed and out of reach.
        <div
          aria-hidden="true"
          className={cn(
            "fixed inset-0 z-40 bg-black/40 backdrop-blur-[3px] transition-opacity duration-250 motion-reduce:transition-none",
            shown ? "opacity-100" : "opacity-0"
          )}
        />,
        document.body
      )}
      {createPortal(
        <div className="fixed bottom-6 left-1/2 z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2">
          <div
            role="region"
            aria-label={t.title}
            inert={closing}
            className={cn(
              "transition-transform motion-reduce:transition-none",
              shown
                ? "translate-y-0 duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
                : // Fully off the screen: its own height, the gap under it and its shadow.
                  "translate-y-[calc(100%+3rem)] duration-250 ease-in"
            )}
          >
            <div
              className="flex h-14 items-center justify-between gap-3 rounded-xl border bg-background/90 pr-2.5 pl-4 text-sm shadow-sm backdrop-blur-md"
            >
              <p className="min-w-0 truncate text-muted-foreground">{t.help}</p>
              <div className="flex shrink-0 items-center gap-1.5">
                {!isDefault && (
                  <Button variant="ghost" onClick={() => setDraft(DEFAULT_SIDEBAR)}>
                    {t.reset}
                  </Button>
                )}
                <Button variant="outline" onClick={close}>
                  {t.cancel}
                </Button>
                <Button onClick={save}>{t.save}</Button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
