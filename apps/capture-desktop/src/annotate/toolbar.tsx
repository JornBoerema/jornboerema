import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowUpRight01Icon,
  BlurIcon,
  CircleIcon,
  Cursor01Icon,
  HighlighterIcon,
  MinusSignIcon,
  PencilIcon,
  Redo02Icon,
  SquareIcon,
  TextFontIcon,
  Undo02Icon,
} from "@hugeicons/core-free-icons"
import { Button } from "@evido/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@evido/ui/components/dropdown-menu"
import { cn } from "@evido/ui/lib/utils"
import { useI18n } from "../i18n"
import { COLORS, type StrokeSize, type Tool } from "./types"

const isMac = navigator.userAgent.includes("Mac")
const mod = isMac ? "⌘" : "Ctrl+"

type IconType = typeof Cursor01Icon
const TOOLS: { tool: Tool; icon: IconType | null; key: string }[] = [
  { tool: "select", icon: Cursor01Icon, key: "V" },
  { tool: "arrow", icon: ArrowUpRight01Icon, key: "A" },
  { tool: "rect", icon: SquareIcon, key: "R" },
  { tool: "ellipse", icon: CircleIcon, key: "O" },
  { tool: "line", icon: MinusSignIcon, key: "L" },
  { tool: "pen", icon: PencilIcon, key: "P" },
  { tool: "highlight", icon: HighlighterIcon, key: "H" },
  { tool: "text", icon: TextFontIcon, key: "T" },
  { tool: "step", icon: null, key: "N" },
  { tool: "blur", icon: BlurIcon, key: "B" },
]

export function AnnotationToolbar({
  tool,
  onTool,
  color,
  onColor,
  size,
  onSize,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  tool: Tool
  onTool: (tool: Tool) => void
  color: string
  onColor: (color: string) => void
  size: StrokeSize
  onSize: (size: StrokeSize) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}) {
  const { t } = useI18n()
  const tools = t.tools
  return (
    <div className="flex items-center gap-0.5">
      {TOOLS.map(({ tool: item, icon, key }) => (
        <Button
          key={item}
          variant={tool === item ? "secondary" : "ghost"}
          size="icon-sm"
          aria-pressed={tool === item}
          aria-label={tools[item]}
          title={`${tools[item]} (${key})`}
          onClick={() => onTool(item)}
          className={cn(tool === item && "text-primary")}
        >
          {icon ? (
            <HugeiconsIcon icon={icon} strokeWidth={2} />
          ) : (
            <span className="flex size-4 items-center justify-center rounded-full border-[1.5px] border-current text-[9px] font-bold">1</span>
          )}
        </Button>
      ))}

      <span className="mx-1.5 h-5 w-px bg-border" aria-hidden="true" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={tools.style} title={tools.style}>
            <span className="size-4 rounded-full ring-1 ring-foreground/20" style={{ background: color }} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{tools.color}</DropdownMenuLabel>
            <div className="grid grid-cols-7 gap-1 px-2 pb-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => onColor(c)}
                  className={cn("size-5 rounded-full ring-1 ring-foreground/15", c === color && "ring-2 ring-primary ring-offset-1 ring-offset-popover")}
                  style={{ background: c }}
                />
              ))}
            </div>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>{tools.size}</DropdownMenuLabel>
            {(["s", "m", "l"] as const).map((s) => (
              <DropdownMenuItem key={s} onSelect={() => onSize(s)} className={cn(s === size && "text-primary")}>
                <span className="w-5 rounded-full bg-current" style={{ height: { s: 2, m: 4, l: 6 }[s] }} />
                {tools.sizes[s]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button variant="ghost" size="icon-sm" disabled={!canUndo} onClick={onUndo} aria-label={tools.undo} title={`${tools.undo} (${mod}Z)`}>
        <HugeiconsIcon icon={Undo02Icon} strokeWidth={2} />
      </Button>
      <Button variant="ghost" size="icon-sm" disabled={!canRedo} onClick={onRedo} aria-label={tools.redo} title={`${tools.redo} (${mod}⇧Z)`}>
        <HugeiconsIcon icon={Redo02Icon} strokeWidth={2} />
      </Button>
    </div>
  )
}
