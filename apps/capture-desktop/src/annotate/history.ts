import { useCallback, useState } from "react"

/** Undo/redo for a value; only committed states become history entries. */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState({ past: [] as T[], present: initial, future: [] as T[] })
  const commit = useCallback(
    (next: T) => setState((s) => ({ past: [...s.past, s.present], present: next, future: [] })),
    []
  )
  const undo = useCallback(
    () =>
      setState((s) =>
        s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s
      ),
    []
  )
  const redo = useCallback(
    () =>
      setState((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s)),
    []
  )
  return { value: state.present, commit, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 }
}
