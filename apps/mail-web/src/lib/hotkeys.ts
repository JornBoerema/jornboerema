import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react"

/** Holding these keys walks the list; every other shortcut acts once per press. */
const REPEATABLE = new Set(["j", "k"])

function isBlocked(event: KeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey) return true
  if (event.repeat && !REPEATABLE.has(event.key)) return true
  if (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,[contenteditable]"))
    return true
  return document.querySelector("[role=dialog],[role=alertdialog],[role=menu],[role=listbox]") !== null
}

/** Single-key shortcuts, inactive while typing or while a dialog or menu is open. */
export function useHotkeys(bindings: Record<string, () => void>) {
  const latest = useRef(bindings)
  useEffect(() => {
    latest.current = bindings
  })
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const action = latest.current[event.key]
      if (!action || isBlocked(event)) return
      // Otherwise the key would also land in a box this shortcut just focused.
      // Escape types nothing, and other layers such as the composer listen for it too.
      if (event.key !== "Escape") event.preventDefault()
      action()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])
}

/** Cmd/Ctrl+Enter sends the form from any of its fields. */
export function sendOnModEnter(event: ReactKeyboardEvent<HTMLFormElement>) {
  if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return
  event.preventDefault()
  event.currentTarget.requestSubmit()
}
