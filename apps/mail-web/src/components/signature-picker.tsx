import { PenTool03Icon } from "@hugeicons/core-free-icons"
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
import { useI18n } from "@/i18n"
import type { SignatureChoice } from "@/lib/signatures"

const NONE = "none"

/**
 * Swaps the signature of the message being written. As quiet as the
 * attachment button beside it.
 */
export function SignaturePicker({ choice }: { choice: SignatureChoice }) {
  const t = useI18n().t.signatures
  if (choice.signatures.length === 0) return null
  const current = choice.signatures.find((signature) => signature.id === choice.value)
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 max-w-40 min-w-0 gap-1.5 rounded-lg px-2 text-xs font-normal text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground",
            !current && "text-muted-foreground/70"
          )}
        >
          <HugeiconsIcon icon={PenTool03Icon} strokeWidth={1.75} aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">
            <span className="sr-only">{t.pick}: </span>
            {current?.name ?? t.none}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-56">
        <DropdownMenuLabel>{t.pick}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={choice.value ?? NONE}
          onValueChange={(next) => choice.choose(next === NONE ? null : next)}
        >
          {choice.signatures.map((signature) => (
            <DropdownMenuRadioItem key={signature.id} value={signature.id}>
              <span className="truncate">{signature.name}</span>
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value={NONE} className="text-muted-foreground">
            {t.none}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
