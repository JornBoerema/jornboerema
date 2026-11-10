import { toast } from "sonner"

/** How long a change can still be taken back before it reaches the provider. */
export const UNDO_MS = 5000

/** Thrown when the user took the change back; callers treat it as nothing happened. */
export class UndoneError extends Error {}

const waiting = new Set<() => void>()

// Closing the tab doesn't take anything back: what was waiting goes now.
if (typeof window !== "undefined")
  window.addEventListener("pagehide", () => {
    for (const flush of [...waiting]) flush()
  })

/** Whether anything is still waiting to go, for a leave-page warning. */
export const isWaiting = () => waiting.size > 0

/**
 * Shows `message` with an undo button, then lets the change go. Resolves when it
 * may go (`leaving` when the page is closing), rejects with UndoneError if undone.
 */
export function waitForUndo(message: string, undoLabel: string): Promise<{ leaving: boolean }> {
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (leaving: boolean | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      waiting.delete(flush)
      if (leaving === null) {
        toast.dismiss(id)
        reject(new UndoneError())
      } else resolve({ leaving })
    }
    const flush = () => settle(true)
    const timer = window.setTimeout(() => settle(false), UNDO_MS)
    waiting.add(flush)
    const id = toast(message, {
      duration: UNDO_MS,
      action: { label: undoLabel, onClick: () => settle(null) },
    })
  })
}
