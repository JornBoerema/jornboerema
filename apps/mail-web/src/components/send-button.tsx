import { AlarmClockIcon, ArrowDown01Icon, SentIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@evido/ui/components/dropdown-menu"
import { IconTip } from "@/components/icon-tip"
import { useI18n } from "@/i18n"

/**
 * Sends the form it sits in: a round icon, its name and shortcut in a tooltip.
 * With `onLater`, a small arrow beside it offers sending at a later moment.
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
        <DropdownMenu>
          <IconTip label={t.sendLater}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="rounded-full text-muted-foreground"
                disabled={disabled}
                aria-label={t.sendLater}
              >
                <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
          </IconTip>
          <DropdownMenuContent align="end" side="top" sideOffset={6} className="min-w-44 rounded-xl p-1">
            <DropdownMenuItem className="gap-2.5 rounded-lg px-2 py-1.5 text-[13px]" onSelect={onLater}>
              <HugeiconsIcon icon={AlarmClockIcon} strokeWidth={1.75} aria-hidden="true" className="size-3.5" />
              {t.sendLater}…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
