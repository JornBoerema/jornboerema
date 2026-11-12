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

/** No focus ring on this pair: it shows each time the menu hands focus back. */
const NO_RING = "focus-visible:border-transparent focus-visible:ring-0"

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
        className={NO_RING}
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
            className={NO_RING}
            disabled={disabled}
            aria-label={t.sendLater}
          >
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              strokeWidth={2}
              aria-hidden="true"
              className="transition-transform duration-200 ease-out group-aria-expanded/button:rotate-180 motion-reduce:transition-none"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="top"
          sideOffset={6}
          className="min-w-44 p-1"
        >
          <DropdownMenuItem
            className="min-h-7 gap-2.5 rounded-lg px-2 py-1 text-[13px]"
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
