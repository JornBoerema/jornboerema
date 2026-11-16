import { useLayoutEffect, useRef, useState, type ReactNode } from "react"

const GAP = 10
const EDGE = 8
/** Where the card goes when there is nothing to stand beside: under the toolbar, on the right. */
const FALLBACK_TOP = 72

type Place = { left: number; top: number; maxHeight: number }

/**
 * The details or the form of an event, as a card beside what it is about (the event,
 * or the time being planned), over the calendar rather than taking width from it.
 * `anchor` is a selector inside the calendar; without a match the card sits on the right.
 */
export function EventPopover({ anchor, label, children }: { anchor: string | null; label?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const [place, setPlace] = useState<Place | null>(null)
  const last = useRef<Place | null>(null)

  // Every render: the event may have moved, or the view changed under it.
  useLayoutEffect(() => {
    const measure = () => {
      const element = ref.current
      const body = element?.offsetParent
      if (!element || !(body instanceof HTMLElement)) return
      const next = placeOf(element, body, anchor)
      const prev = last.current
      if (prev && prev.left === next.left && prev.top === next.top && prev.maxHeight === next.maxHeight) return
      last.current = next
      setPlace(next)
    }
    measure()
    let frame = 0
    const later = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(later)
    if (ref.current) observer.observe(ref.current)
    if (ref.current?.offsetParent) observer.observe(ref.current.offsetParent)
    document.addEventListener("scroll", later, true)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener("scroll", later, true)
    }
  })

  return (
    <aside
      ref={ref}
      className="plan-panel plan-popover"
      aria-label={label}
      data-placed={place ? "" : undefined}
      style={place ? { left: place.left, top: place.top, maxHeight: place.maxHeight } : { visibility: "hidden" }}
    >
      {children}
    </aside>
  )
}

function placeOf(element: HTMLElement, body: HTMLElement, anchor: string | null): Place {
  const bounds = body.getBoundingClientRect()
  const width = element.offsetWidth
  const height = element.offsetHeight
  const maxHeight = bounds.height - EDGE * 2
  const target = anchor ? body.querySelector(anchor) : null
  const rect = target?.getBoundingClientRect()
  const right = bounds.width - EDGE - width
  if (!rect || rect.width === 0) {
    return { left: right, top: Math.min(FALLBACK_TOP, Math.max(EDGE, bounds.height - EDGE - height)), maxHeight }
  }
  const after = rect.right - bounds.left + GAP
  const before = rect.left - bounds.left - GAP - width
  const left = after + width <= bounds.width - EDGE ? after : before >= EDGE ? before : right
  const top = Math.min(Math.max(rect.top - bounds.top, EDGE), Math.max(EDGE, bounds.height - EDGE - height))
  return { left, top, maxHeight }
}
