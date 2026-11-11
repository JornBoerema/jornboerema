import { useCallback, useRef } from "react"

/**
 * Marks a scroller with `data-fade-top` once it has scrolled down and
 * `data-fade-bottom` while more lies below, so `.scroll-fade` can soften the
 * edges where rows slide out of view. Attributes, not state: no re-render on
 * scroll. A callback ref, so a scroller that mounts later is picked up too.
 */
export function useScrollFade<E extends HTMLElement>() {
  const cleanup = useRef<(() => void) | null>(null)
  return useCallback((element: E | null) => {
    cleanup.current?.()
    cleanup.current = null
    if (!element) return
    const update = () => {
      element.toggleAttribute("data-fade-top", element.scrollTop > 1)
      element.toggleAttribute(
        "data-fade-bottom",
        element.scrollTop + element.clientHeight < element.scrollHeight - 1
      )
    }
    update()
    element.addEventListener("scroll", update, { passive: true })
    // Rows load and leave, and the pane resizes; the edges follow both.
    const resize = new ResizeObserver(update)
    resize.observe(element)
    const content = new MutationObserver(update)
    content.observe(element, { childList: true, subtree: true })
    cleanup.current = () => {
      element.removeEventListener("scroll", update)
      resize.disconnect()
      content.disconnect()
    }
  }, [])
}
