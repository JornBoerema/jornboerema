import { useCallback, useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { save } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Copy01Icon, Download04Icon } from "@hugeicons/core-free-icons"
import { Button } from "@evido/ui/components/button"
import { Brand } from "./brand"
import { AnnotationCanvas, type CanvasHandle } from "./annotate/canvas"
import { AnnotationToolbar } from "./annotate/toolbar"
import { useHistory } from "./annotate/history"
import { COLORS, TOOL_KEYS, type Shape, type StrokeSize, type Tool } from "./annotate/types"
import { captureUrl, commands, timestamp } from "./lib"
import { useI18n } from "./i18n"

const isMac = navigator.userAgent.includes("Mac")
const mod = isMac ? "⌘" : "Ctrl"

/**
 * Loads a capture as a same-origin blob image, so the canvas stays exportable
 * (an image straight from the capture:// protocol would taint it).
 */
function useCaptureImage(id: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let url = ""
    let cancelled = false
    fetch(captureUrl(id))
      .then((response) => response.blob())
      .then((blob) => {
        url = URL.createObjectURL(blob)
        const img = new Image()
        img.onload = () => !cancelled && setImage(img)
        img.onerror = () => setFailed(true)
        img.src = url
      })
      .catch(() => setFailed(true))
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [id])
  return { image, failed }
}

/** Shows one capture with annotation tools. Copy (⌘C) copies and closes, Save (⌘S) asks where. */
export function Editor({ id }: { id: string }) {
  const { t } = useI18n()
  const { image, failed } = useCaptureImage(id)
  const canvas = useRef<CanvasHandle>(null)
  const history = useHistory<Shape[]>([])
  const shapes = history.value
  const [tool, setTool] = useState<Tool>("arrow")
  const [color, setColor] = useState<string>(COLORS[0])
  const [size, setSize] = useState<StrokeSize>("m")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (failed) toast.error(t.editor.failed)
  }, [failed, t])

  const close = useCallback(() => void getCurrentWindow().close(), [])

  /** Without drawings the original capture is used as-is (exact and fastest). */
  const exported = useCallback(async () => (shapes.length && canvas.current ? canvas.current.exportPng() : null), [shapes])

  const copy = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const png = await exported()
      if (png) await invoke("copy_png", png)
      else await commands.copy(id)
      close()
    } catch {
      toast.error(t.editor.failed)
      setBusy(false)
    }
  }, [busy, close, exported, id, t])

  const saveAs = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const path = await save({
        defaultPath: t.editor.fileName(timestamp()),
        filters: [{ name: "PNG", extensions: ["png"] }],
      })
      if (path) {
        const png = await exported()
        if (png) await invoke("save_png", png, { headers: { "x-path": encodeURIComponent(path) } })
        else await commands.save(id, path)
        toast.success(t.editor.saved(path))
      }
    } catch {
      toast.error(t.editor.failed)
    } finally {
      setBusy(false)
    }
  }, [busy, exported, id, t])

  const chooseTool = useCallback((next: Tool) => {
    setTool(next)
    if (next !== "select") setSelectedId(null)
  }, [])

  // Colour and size apply to new drawings and to the selected one.
  const restyle = (patch: Partial<Pick<Shape, "color" | "size">>) => {
    if (!selectedId) return
    history.commit(shapes.map((s) => (s.id === selectedId ? ({ ...s, ...patch } as Shape) : s)))
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return
      const modifier = isMac ? event.metaKey : event.ctrlKey
      const key = event.key.toLowerCase()
      if (modifier && key === "z") {
        event.preventDefault()
        if (event.shiftKey) history.redo()
        else history.undo()
      } else if (modifier && key === "c" && !window.getSelection()?.toString()) {
        event.preventDefault()
        void copy()
      } else if (modifier && key === "s") {
        event.preventDefault()
        void saveAs()
      } else if ((event.key === "Backspace" || event.key === "Delete") && selectedId) {
        history.commit(shapes.filter((s) => s.id !== selectedId))
        setSelectedId(null)
      } else if (event.key === "Escape") {
        if (selectedId) setSelectedId(null)
        else close()
      } else if (!modifier && !event.altKey && TOOL_KEYS[key]) {
        chooseTool(TOOL_KEYS[key])
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [chooseTool, close, copy, history, saveAs, selectedId, shapes])

  return (
    <div className="flex h-full flex-col bg-black">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3" data-tauri-drag-region>
        <div className="pl-[80px]" data-tauri-drag-region>
          <Brand />
        </div>
        {image && (
          <span className="hidden text-xs text-muted-foreground tabular-nums lg:inline" data-tauri-drag-region>
            {t.editor.size(image.naturalWidth, image.naturalHeight)}
          </span>
        )}
        <div className="mx-auto" data-tauri-drag-region>
          <AnnotationToolbar
            tool={tool}
            onTool={chooseTool}
            color={color}
            onColor={(c) => {
              setColor(c)
              restyle({ color: c })
            }}
            size={size}
            onSize={(s) => {
              setSize(s)
              restyle({ size: s })
            }}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={history.undo}
            onRedo={history.redo}
          />
        </div>
        <div className="flex items-center gap-1">
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
      <main className="min-h-0 flex-1">
        {image ? (
          <AnnotationCanvas
            ref={canvas}
            image={image}
            tool={tool}
            color={color}
            size={size}
            shapes={shapes}
            onCommit={history.commit}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        ) : (
          <p className="flex h-full items-center justify-center text-sm text-muted-foreground">{t.editor.loading}</p>
        )}
      </main>
    </div>
  )
}
