import { useCallback, useEffect, useMemo, useState } from "react"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Copy01Icon, Delete02Icon, Download04Icon, Image01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@evido/ui/components/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@evido/ui/components/empty"
import { Brand } from "./brand"
import {
  chooseSavePath,
  commands,
  formatShortcut,
  HISTORY_CHANGED,
  isMac,
  thumbnailUrl,
  timestamp,
  type HistoryEntry,
  type Settings,
} from "./lib"
import { useI18n } from "./i18n"

const DAY = 24 * 60 * 60 * 1000

/** Midnight (local time) of the day a timestamp falls on. */
const startOfDay = (time: number) => new Date(time).setHours(0, 0, 0, 0)

/** All kept screenshots in a grid, newest first, grouped by day. Click one to edit it. */
export function HistoryWindow() {
  const { t, locale } = useI18n()
  const h = t.history
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)

  const reload = useCallback(() => {
    void commands.history().then(setEntries)
    void commands.settings().then(setSettings)
  }, [])

  useEffect(() => {
    reload()
    const unlisten = listen(HISTORY_CHANGED, reload)
    // Settings (history on or off) may change while this window is open.
    window.addEventListener("focus", reload)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void getCurrentWindow().close()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      void unlisten.then((stop) => stop())
      window.removeEventListener("focus", reload)
      window.removeEventListener("keydown", onKey)
    }
  }, [reload])

  const groups = useMemo(() => {
    const today = startOfDay(Date.now())
    const dateFormat = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" })
    const map = new Map<number, HistoryEntry[]>()
    for (const entry of entries ?? []) {
      const day = startOfDay(entry.createdAt)
      map.set(day, [...(map.get(day) ?? []), entry])
    }
    return [...map].map(([day, items]) => ({
      day,
      label: day === today ? h.today : day === today - DAY ? h.yesterday : dateFormat.format(day),
      items,
    }))
  }, [entries, locale, h])

  const run = async (work: () => Promise<unknown>, success?: string) => {
    try {
      await work()
      if (success) toast.success(success)
    } catch {
      toast.error(h.failed)
    }
  }

  const timeFormat = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" })

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3" data-tauri-drag-region>
        <div className={isMac ? "pl-[80px]" : "pl-1"} data-tauri-drag-region>
          <Brand />
        </div>
        <span className="text-sm text-muted-foreground" data-tauri-drag-region>
          {h.title}
        </span>
        {!!entries?.length && (
          <span className="ml-auto pr-1 text-xs text-muted-foreground tabular-nums" data-tauri-drag-region>
            {h.count(entries.length)}
          </span>
        )}
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        {entries && settings && !entries.length ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={Image01Icon} strokeWidth={2} />
              </EmptyMedia>
              <EmptyTitle>{settings.keepHistory ? h.empty : h.off}</EmptyTitle>
              <EmptyDescription>
                {settings.keepHistory ? h.emptyHelp(formatShortcut(settings.shortcuts.area)) : h.offHelp}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-6 p-5">
            {groups.map((group) => (
              <section key={group.day} className="flex flex-col gap-3">
                <h2 className="text-sm font-medium first-letter:uppercase">{group.label}</h2>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
                  {group.items.map((entry) => (
                    <li key={entry.id} className="group flex flex-col gap-1.5">
                      <div className="relative">
                        <button
                          type="button"
                          title={h.open}
                          onClick={() => void run(() => commands.openHistoryEntry(entry.id))}
                          className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg bg-muted ring-1 ring-border transition-shadow outline-none hover:ring-2 hover:ring-primary/60 focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <img
                            src={thumbnailUrl(entry)}
                            alt=""
                            loading="lazy"
                            draggable={false}
                            className="max-h-full max-w-full object-contain"
                          />
                        </button>
                        <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                          <Button
                            variant="outline"
                            size="icon-xs"
                            className="bg-background/90 shadow-sm backdrop-blur dark:bg-background/90"
                            aria-label={h.copy}
                            title={h.copy}
                            onClick={() => void run(() => commands.copyHistoryEntry(entry.id), h.copied)}
                          >
                            <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon-xs"
                            className="bg-background/90 shadow-sm backdrop-blur dark:bg-background/90"
                            aria-label={h.save}
                            title={h.save}
                            onClick={() =>
                              void run(async () => {
                                const path = await chooseSavePath(t.editor.fileName(timestamp(new Date(entry.createdAt))))
                                if (!path) return
                                await commands.saveHistoryEntry(entry.id, path)
                                toast.success(h.saved(path))
                              })
                            }
                          >
                            <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon-xs"
                            className="bg-background/90 shadow-sm backdrop-blur dark:bg-background/90"
                            aria-label={h.delete}
                            title={h.delete}
                            onClick={() => void run(() => commands.deleteHistoryEntry(entry.id), h.deleted)}
                          >
                            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                          </Button>
                        </div>
                      </div>
                      <p className="flex justify-between gap-2 px-0.5 text-xs text-muted-foreground tabular-nums">
                        <span>{timeFormat.format(entry.createdAt)}</span>
                        <span>{t.editor.size(entry.width, entry.height)}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
