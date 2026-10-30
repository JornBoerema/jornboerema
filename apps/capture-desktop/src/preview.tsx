import { useEffect, useRef, useState } from "react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, CheckmarkCircle02Icon, FolderOpenIcon, PencilEdit02Icon } from "@hugeicons/core-free-icons"
import { Button } from "@evido/ui/components/button"
import { captureUrl, commands, isMac } from "./lib"
import { useI18n } from "./i18n"

/** How long the preview stays when the mouse is not on it. */
const VISIBLE_MS = 5000

/**
 * Confirms a copy or save with a thumbnail in the corner of the screen.
 * Click it to edit; it closes by itself unless the mouse rests on it.
 */
export function Preview({ id, path }: { id: string; path: string | null }) {
  const { t } = useI18n()
  const p = t.preview
  const [hovered, setHovered] = useState(false)
  const [shown, setShown] = useState(false)
  const timer = useRef<number>(undefined)
  const close = () => void getCurrentWindow().close()
  const folder = path?.split(/[\\/]/).slice(-2, -1)[0]

  useEffect(() => {
    if (!shown || hovered) return
    timer.current = window.setTimeout(close, VISIBLE_MS)
    return () => window.clearTimeout(timer.current)
  }, [shown, hovered])

  return (
    <div
      className="flex h-full flex-col overflow-hidden border bg-background select-none"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className="group relative min-h-0 flex-1 cursor-pointer bg-muted"
        title={p.edit}
        onClick={() => void commands.editPreview(id)}
      >
        <img
          src={captureUrl(id)}
          alt=""
          draggable={false}
          className="size-full object-contain"
          onLoad={() => {
            setShown(true)
            void getCurrentWindow().show()
          }}
          onError={close}
        />
        <span className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/45 text-sm font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
          <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} className="size-4" />
          {p.edit}
        </span>
      </button>
      <footer className="flex h-10 shrink-0 items-center gap-1.5 border-t pr-1 pl-2.5">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-xs" title={path ?? undefined}>
          {path ? p.saved(folder ?? "") : p.copied}
        </span>
        {path && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={isMac ? p.revealMac : p.revealWindows}
            title={isMac ? p.revealMac : p.revealWindows}
            onClick={() => {
              void commands.revealFile(path)
              close()
            }}
          >
            <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} />
          </Button>
        )}
        <Button variant="ghost" size="icon-xs" aria-label={p.close} title={p.close} onClick={close}>
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
        </Button>
      </footer>
    </div>
  )
}
