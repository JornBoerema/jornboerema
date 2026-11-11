import { useEffect } from "react"
import { getCurrentWindow } from "@tauri-apps/api/window"

/** The strip along the top of the window that works as its title bar. */
const TITLE_BAR_HEIGHT = 52

/** Controls in that strip keep their clicks; everything else moves the window. */
const INTERACTIVE =
  "button, a, input, textarea, select, label, summary, [contenteditable], [role=button], [role=menuitem], [role=tab], [role=checkbox], [role=switch], [role=combobox], [role=option], [data-no-drag]"

/**
 * The window has no title bar (its buttons sit over the sidebar), so the top
 * of the window drags it, and a double-click zooms it, as a title bar would.
 */
export function useWindowDragging() {
  useEffect(() => {
    const appWindow = getCurrentWindow()
    const onTitleBar = (event: MouseEvent) =>
      event.button === 0 &&
      event.clientY <= TITLE_BAR_HEIGHT &&
      event.target instanceof Element &&
      !event.target.closest(INTERACTIVE) &&
      !document.querySelector("[role=dialog], [role=alertdialog]")
    const mousedown = (event: MouseEvent) => {
      if (!onTitleBar(event) || event.detail > 1) return
      event.preventDefault()
      void appWindow.startDragging()
    }
    const dblclick = (event: MouseEvent) => {
      if (onTitleBar(event)) void appWindow.toggleMaximize()
    }
    document.addEventListener("mousedown", mousedown)
    document.addEventListener("dblclick", dblclick)
    return () => {
      document.removeEventListener("mousedown", mousedown)
      document.removeEventListener("dblclick", dblclick)
    }
  }, [])
}
