import { Mail01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

export function Brand() {
  return (
    <div className="brand">
      <HugeiconsIcon icon={Mail01Icon} strokeWidth={2.5} aria-hidden="true" className="size-5" />
      <span>
        Even mailen<span className="text-primary">.</span>
      </span>
    </div>
  )
}
