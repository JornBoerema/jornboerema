import { useRef } from "react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@evido/ui/components/command"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@evido/ui/components/dialog"
import { useI18n } from "@/i18n"

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = IS_MAC ? "⌘" : "Ctrl"

type Shortcut = { keys: string[]; label: string; run?: () => void }

/**
 * Every key the app knows, searchable, in the spirit of Omarchy's keybindings
 * menu: keys on the left, what they do on the right. Enter runs the ones that
 * make sense from here.
 */
export function ShortcutsSpotlight({
  open,
  onOpenChange,
  onCompose,
  onSearch,
  onSettings,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCompose: () => void
  onSearch: () => void
  onSettings: () => void
}) {
  const t = useI18n().t.shortcuts
  const previousFocus = useRef<HTMLElement | null>(null)
  const groups: { heading: string; items: Shortcut[] }[] = [
    {
      heading: t.general,
      items: [
        { keys: [MOD, "K"], label: t.search, run: onSearch },
        { keys: ["/"], label: t.search, run: onSearch },
        { keys: ["C"], label: t.compose, run: onCompose },
        { keys: [MOD, ","], label: t.settings, run: onSettings },
        { keys: [MOD, "B"], label: t.sidebar },
        { keys: ["?"], label: t.shortcuts },
        { keys: ["Esc"], label: t.close },
      ],
    },
    {
      heading: t.list,
      items: [
        { keys: ["J"], label: t.next },
        { keys: ["K"], label: t.previous },
        { keys: ["X"], label: t.select },
        { keys: [t.space], label: t.selectHovered },
        { keys: ["Shift", t.space], label: t.selectRange },
        { keys: [MOD, "A"], label: t.selectAll },
      ],
    },
    {
      heading: t.conversation,
      items: [
        { keys: ["R"], label: t.reply },
        { keys: ["A"], label: t.replyAll },
        { keys: ["F"], label: t.forward },
        { keys: ["E"], label: t.archive },
        { keys: ["#"], label: t.trash },
        { keys: ["I"], label: t.moveToInbox },
        { keys: ["!"], label: t.reportSpam },
        { keys: ["S"], label: t.star },
        { keys: ["B"], label: t.snooze },
        { keys: ["U"], label: t.markUnread },
      ],
    },
    {
      heading: t.writing,
      items: [
        { keys: [MOD, "Enter"], label: t.send },
        { keys: [MOD, "J"], label: t.aiWrite },
        { keys: [MOD, "B"], label: t.bold },
        { keys: [MOD, "I"], label: t.italic },
        { keys: [MOD, "U"], label: t.underline },
        { keys: [MOD, "K"], label: t.link },
        { keys: ["Esc"], label: t.hideComposer },
      ],
    },
  ]

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value) previousFocus.current = document.activeElement as HTMLElement
        onOpenChange(value)
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="list-spotlight sm:max-w-2xl"
        style={{ translate: "-50% 0" }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (previousFocus.current?.isConnected) previousFocus.current.focus()
        }}
      >
        <DialogTitle className="sr-only">{t.title}</DialogTitle>
        <DialogDescription className="sr-only">{t.description}</DialogDescription>
        <Command loop>
          <CommandInput aria-label={t.title} placeholder={t.placeholder} autoComplete="off" spellCheck={false} />
          <CommandList aria-label={t.title} className="max-h-[min(520px,60dvh)]!">
            <CommandEmpty>{t.empty}</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.heading} heading={group.heading}>
                {group.items.map((item) => (
                  <CommandItem
                    key={`${group.heading}-${item.keys.join("+")}-${item.label}`}
                    value={`${group.heading} ${item.label} ${item.keys.join(" ")}`}
                    onSelect={() => {
                      if (!item.run) return
                      onOpenChange(false)
                      item.run()
                    }}
                  >
                    <span className="flex w-40 shrink-0 items-center gap-1 font-mono text-xs tracking-wide uppercase">
                      {item.keys.map((key, index) => (
                        <span key={key} className="flex items-center gap-1">
                          {index > 0 && <span className="text-muted-foreground">+</span>}
                          <kbd className="rounded-md border bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                            {key}
                          </kbd>
                        </span>
                      ))}
                    </span>
                    <span className="text-muted-foreground" aria-hidden="true">
                      →
                    </span>
                    <span className="spotlight-name">{item.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
