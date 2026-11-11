import { createContext, useContext, useState } from "react"
import { ArrowReloadHorizontalIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

export type ReadyUpdate = {
  version: string
  /** "Restart to update" in the app's language. */
  label: string
  restarting: string
  install: () => Promise<void>
}

const UpdateContext = createContext<ReadyUpdate | null>(null)

/** Set by the Even desktop app once a new version has downloaded. */
export const UpdateProvider = UpdateContext.Provider

/**
 * "Restart to update", above the account menu in an app's sidebar, once the
 * desktop app has a new version ready. Nothing on the web.
 */
export function UpdateButton() {
  const update = useContext(UpdateContext)
  const [restarting, setRestarting] = useState(false)
  if (!update) return null
  return (
    <button
      type="button"
      className="update-button"
      disabled={restarting}
      onClick={() => {
        setRestarting(true)
        update.install().catch(() => setRestarting(false))
      }}
    >
      <HugeiconsIcon icon={ArrowReloadHorizontalIcon} strokeWidth={2} aria-hidden="true" className="size-4 shrink-0" />
      <span className="flex-1 truncate text-left">{restarting ? update.restarting : update.label}</span>
      <span className="update-version">{update.version}</span>
    </button>
  )
}
