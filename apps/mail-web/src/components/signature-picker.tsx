import { Pen02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@evido/ui/components/dropdown-menu"
import { cn } from "@evido/ui/lib/utils"
import { IconTip } from "@/components/icon-tip"
import { useI18n } from "@/i18n"
import type { SignatureChoice } from "@/lib/signatures"

const NONE = "none"
/** The same compact rows as the send button's menu. */
const ITEM = "min-h-7 rounded-lg py-1 text-[13px] [&_svg:not([class*='size-'])]:size-3.5"

/**
 * Swaps the signature of the message being written. An icon like the
 * attachment and AI buttons beside it; the chosen signature shows in the
 * message itself, and its name in the tooltip.
 */
export function SignaturePicker({ choice }: { choice: SignatureChoice }) {
  const t = useI18n().t.signatures
  if (choice.signatures.length === 0) return null
  const current = choice.signatures.find((signature) => signature.id === choice.value)
  return (
    <DropdownMenu modal={false}>
      <IconTip label={`${t.pick}: ${current?.name ?? t.none}`}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`${t.pick}: ${current?.name ?? t.none}`}
            className="data-[state=open]:bg-accent data-[state=open]:text-foreground"
          >
            <HugeiconsIcon icon={Pen02Icon} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
      </IconTip>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-52 rounded-xl p-1">
        <DropdownMenuLabel>{t.pick}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={choice.value ?? NONE}
          onValueChange={(next) => choice.choose(next === NONE ? null : next)}
        >
          {choice.signatures.map((signature) => (
            <DropdownMenuRadioItem key={signature.id} value={signature.id} className={ITEM}>
              <span className="truncate">{signature.name}</span>
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value={NONE} className={cn(ITEM, "text-muted-foreground")}>
            {t.none}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
