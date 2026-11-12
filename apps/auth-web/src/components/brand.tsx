import { UserCircleIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

/** The brand as in Even doen and Even mailen: the app's icon and its name. */
export function Brand() {
  return (
    <div className="brand">
      <HugeiconsIcon icon={UserCircleIcon} strokeWidth={2.5} aria-hidden="true" className="size-5" />
      <span>
        Even account<span className="text-primary">.</span>
      </span>
    </div>
  )
}
