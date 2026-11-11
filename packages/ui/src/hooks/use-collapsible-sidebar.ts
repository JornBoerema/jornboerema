import * as React from "react"

const OPEN_LAYER =
  '[role="dialog"]:not([data-state="closed"]), [role="alertdialog"]:not([data-state="closed"]), [role="menu"]:not([data-state="closed"])'

/**
 * Collapse state for the shared sidebar (`#list-sidebar`), including ⌘/Ctrl+B.
 * Attach `expandButton` to the control that brings the sidebar back.
 */
export function useCollapsibleSidebar({ enabled = true }: { enabled?: boolean } = {}) {
  const [collapsed, setCollapsed] = React.useState(false)
  const expandButton = React.useRef<HTMLButtonElement>(null)
  const focusPending = React.useRef(false)

  function toggle() {
    focusPending.current = true
    setCollapsed((value) => !value)
  }

  React.useEffect(() => {
    if (!focusPending.current) return
    let cancelled = false
    const frame = requestAnimationFrame(async () => {
      // Collapsing focuses the expand control; expanding returns to the sidebar.
      const button = collapsed
        ? expandButton.current
        : document.querySelector<HTMLButtonElement>("#list-sidebar .workspace-switcher")
      if (!button) return
      // After the panel has moved too, so its tooltip doesn't open mid-way.
      const panel = document.getElementById("list-sidebar")
      const moving = [...button.getAnimations(), ...(panel?.getAnimations() ?? [])]
      await Promise.allSettled(moving.map((animation) => animation.finished))
      if (!cancelled) {
        button.focus()
        focusPending.current = false
      }
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [collapsed])

  React.useEffect(() => {
    if (!enabled) return
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "b" ||
        event.altKey ||
        event.shiftKey ||
        event.repeat ||
        event.isComposing
      )
        return
      // Keep rich-text shortcuts and modal focus within their own editors/dialogs.
      if (event.target instanceof HTMLElement && event.target.isContentEditable) return
      if (document.querySelector(OPEN_LAYER)) return
      event.preventDefault()
      focusPending.current =
        !!document.activeElement?.closest("#list-sidebar") ||
        document.activeElement === expandButton.current
      setCollapsed((value) => !value)
    }
    document.addEventListener("keydown", keydown)
    return () => document.removeEventListener("keydown", keydown)
  }, [enabled])

  return { collapsed, toggle, expandButton }
}
