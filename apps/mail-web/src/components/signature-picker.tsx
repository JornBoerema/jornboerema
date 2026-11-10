import { PenTool03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@evido/ui/components/select"
import { cn } from "@evido/ui/lib/utils"
import { useI18n } from "@/i18n"
import type { SignatureChoice } from "@/lib/signatures"

const NONE = "none"

/** Swaps the signature of the message being written. Hidden until there are signatures. */
export function SignaturePicker({ choice }: { choice: SignatureChoice }) {
  const t = useI18n().t.signatures
  if (choice.signatures.length === 0) return null
  return (
    <Select
      value={choice.value ?? NONE}
      onValueChange={(next) => choice.choose(next === NONE ? null : next)}
    >
      <SelectTrigger
        size="sm"
        aria-label={t.pick}
        title={t.pick}
        className={cn(
          "max-w-44 min-w-0 gap-1.5 border-transparent bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:bg-accent hover:text-foreground dark:bg-transparent dark:hover:bg-accent",
          choice.value === null && "text-muted-foreground/70"
        )}
      >
        <HugeiconsIcon
          icon={PenTool03Icon}
          strokeWidth={1.75}
          aria-hidden="true"
          className="size-4 shrink-0"
        />
        <span className="truncate">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent align="start">
        <SelectGroup>
          <SelectItem value={NONE}>{t.none}</SelectItem>
          {choice.signatures.map((signature) => (
            <SelectItem key={signature.id} value={signature.id}>
              {signature.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
