import { SentIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { IconTip } from "@/components/icon-tip"

/** Sends the form it sits in: a round icon, its name and shortcut in a tooltip. */
export function SendButton({ label, disabled }: { label: string; disabled?: boolean }) {
  return (
    <IconTip label={label} shortcut="⌘↵">
      <Button
        type="submit"
        size="icon"
        className="rounded-full"
        disabled={disabled}
        aria-label={label}
        aria-keyshortcuts="Meta+Enter Control+Enter"
      >
        <HugeiconsIcon icon={SentIcon} strokeWidth={2} aria-hidden="true" />
      </Button>
    </IconTip>
  )
}
