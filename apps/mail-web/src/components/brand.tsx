import { Mail01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

export function Brand() {
  return (
    <div className="flex items-center gap-2 text-base font-[650] tracking-[-0.4px]">
      <HugeiconsIcon icon={Mail01Icon} strokeWidth={2.5} aria-hidden="true" className="size-4.5 text-primary" />
      <span>
        Even mailen<span className="text-primary">.</span>
      </span>
    </div>
  )
}
