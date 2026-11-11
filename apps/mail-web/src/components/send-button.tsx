import { AlarmClockIcon, SentIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { IconTip } from "@/components/icon-tip"
import { useI18n } from "@/i18n"

/**
 * Sends the form it sits in: a round icon, its name and shortcut in a tooltip.
 * With `onLater`, a clock beside it picks a later moment to send.
 */
export function SendButton({
  label,
  disabled,
  onLater,
}: {
  label: string
  disabled?: boolean
  onLater?: () => void
}) {
  const t = useI18n().t.later
  return (
    <span className="flex items-center gap-0.5">
      {onLater && (
        <IconTip label={t.sendLater}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-full text-muted-foreground"
            disabled={disabled}
            aria-label={t.sendLater}
            onClick={onLater}
          >
            <HugeiconsIcon icon={AlarmClockIcon} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </IconTip>
      )}
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
    </span>
  )
}
