import { useCallback, useEffect, useState } from "react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { save } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Copy01Icon, Download04Icon } from "@hugeicons/core-free-icons"
import { Button } from "@evido/ui/components/button"
import { Brand } from "./brand"
import { captureUrl, commands, timestamp, type CaptureInfo } from "./lib"
import { useI18n } from "./i18n"

const isMac = navigator.userAgent.includes("Mac")
const mod = isMac ? "⌘" : "Ctrl"

/** Shows one capture. Copy (⌘C) copies and closes, Save (⌘S) asks where. */
export function Editor({ id }: { id: string }) {
  const { t } = useI18n()
  const [info, setInfo] = useState<CaptureInfo | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    commands.info(id).then(setInfo, () => toast.error(t.editor.failed))
  }, [id, t])

  const close = useCallback(() => void getCurrentWindow().close(), [])

  const copy = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await commands.copy(id)
      close()
    } catch {
      toast.error(t.editor.failed)
      setBusy(false)
    }
  }, [busy, close, id, t])

  const saveAs = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const path = await save({
        defaultPath: t.editor.fileName(timestamp()),
        filters: [{ name: "PNG", extensions: ["png"] }],
      })
      if (path) {
        await commands.save(id, path)
        toast.success(t.editor.saved(path))
      }
    } catch {
      toast.error(t.editor.failed)
    } finally {
      setBusy(false)
    }
  }, [busy, id, t])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const modifier = isMac ? event.metaKey : event.ctrlKey
      if (event.key === "Escape") close()
      else if (modifier && event.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
        event.preventDefault()
        void copy()
      } else if (modifier && event.key.toLowerCase() === "s") {
        event.preventDefault()
        void saveAs()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [close, copy, saveAs])

  return (
    <div className="flex h-full flex-col bg-black">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3" data-tauri-drag-region>
        <div className="pl-[80px]" data-tauri-drag-region>
          <Brand />
        </div>
        {info && (
          <span className="text-xs text-muted-foreground tabular-nums" data-tauri-drag-region>
            {t.editor.size(info.width, info.height)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" disabled={busy} onClick={() => void saveAs()}
            aria-label={t.editor.save} title={`${t.editor.save} (${mod}S)`}>
            <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
          </Button>
          <Button variant="ghost" size="icon-sm" disabled={busy} onClick={() => void copy()}
            aria-label={t.editor.copy} title={`${t.editor.copy} (${mod}C)`}>
            <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
          </Button>
        </div>
      </header>
      {/* The window is sized to the image, so it fills this area edge to edge. */}
      <main className="flex min-h-0 flex-1 items-center justify-center">
        {info ? (
          <img src={captureUrl(id)} alt="" draggable={false} className="size-full object-contain" />
        ) : (
          <p className="text-sm text-muted-foreground">{t.editor.loading}</p>
        )}
      </main>
    </div>
  )
}
