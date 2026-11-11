import { AlarmClockIcon, ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import {
  ButtonGroup,
  ButtonGroupSeparator,
} from "@evido/ui/components/button-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@evido/ui/components/dropdown-menu"
import { IconTip } from "@/components/icon-tip"
import { useI18n } from "@/i18n"

/**
 * Sends the form it sits in: its name, the shortcut in a tooltip.
 * With `onLater`, a split button: the arrow on its right opens "Send later".
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
  const send = (
    <IconTip label={label} shortcut="⌘↵">
      <Button
        type="submit"
        disabled={disabled}
        aria-keyshortcuts="Meta+Enter Control+Enter"
      >
        {label}
      </Button>
    </IconTip>
  )
  if (!onLater) return send
  return (
    <ButtonGroup>
      {send}
      <ButtonGroupSeparator />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            disabled={disabled}
            aria-label={t.sendLater}
          >
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              strokeWidth={2}
              aria-hidden="true"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="top"
          sideOffset={6}
          className="min-w-44 rounded-xl p-1"
        >
          <DropdownMenuItem
            className="gap-2.5 rounded-lg px-2 py-1.5 text-[13px]"
            onSelect={onLater}
          >
            <HugeiconsIcon
              icon={AlarmClockIcon}
              strokeWidth={1.75}
              aria-hidden="true"
              className="size-3.5"
            />
            {t.sendLater}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  )
}
