import { useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { captureUrl } from "./lib"

type Point = { x: number; y: number }
type WindowTarget = { id: number; title: string; app: string; x: number; y: number; width: number; height: number }

const MIN_SIZE = 3
const LABEL_GAP = 16

const cancel = () => void invoke("close_overlays")

/**
 * Selection on top of a frozen screenshot of one monitor. Area mode: drag to
 * select. Window mode: the window under the cursor lights up; click to capture.
 * Esc or right-click cancels. Sizes are shown in real (physical) pixels.
 */
export function Overlay({ id, mode }: { id: string; mode: "area" | "window" }) {
  const image = useRef<HTMLImageElement>(null)
  const [cursor, setCursor] = useState<Point | null>(null)
  const [start, setStart] = useState<Point | null>(null)
  const [scale, setScale] = useState(1)
  const [targets, setTargets] = useState<WindowTarget[]>([])

  useEffect(() => {
    if (mode === "window") void invoke<WindowTarget[]>("overlay_targets", { id }).then(setTargets)
  }, [id, mode])

  // Front-most window under the cursor (the list is ordered front to back).
  const hovered =
    mode === "window" && cursor
      ? targets.find((t) => cursor.x >= t.x && cursor.y >= t.y && cursor.x < t.x + t.width && cursor.y < t.y + t.height)
      : undefined

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const selection =
    mode === "area" && start && cursor
      ? {
          x: Math.min(start.x, cursor.x),
          y: Math.min(start.y, cursor.y),
          width: Math.abs(cursor.x - start.x),
          height: Math.abs(cursor.y - start.y),
        }
      : null

  function finish() {
    if (!selection || selection.width < MIN_SIZE || selection.height < MIN_SIZE) {
      setStart(null)
      return
    }
    void invoke("crop_capture", { id, ...selection, viewportWidth: window.innerWidth })
  }

  const label = hovered
    ? `${hovered.app}${hovered.title ? ` — ${hovered.title}` : ""} · ${Math.round(hovered.width * scale)} × ${Math.round(hovered.height * scale)}`
    : selection
    ? `${Math.round(selection.width * scale)} × ${Math.round(selection.height * scale)}`
    : cursor
      ? `${Math.round(cursor.x * scale)}, ${Math.round(cursor.y * scale)}`
      : ""
  // Keep the label on screen near the right and bottom edges.
  const flipX = cursor ? cursor.x + 140 > window.innerWidth : false
  const flipY = cursor ? cursor.y + 48 > window.innerHeight : false

  return (
    <div
      className={`fixed inset-0 select-none overflow-hidden ${mode === "window" ? "cursor-pointer" : "cursor-crosshair"}`}
      onMouseMove={(event) => setCursor({ x: event.clientX, y: event.clientY })}
      onMouseDown={(event) => {
        if (event.button === 2) return cancel()
        if (event.button !== 0) return
        if (mode === "window") {
          if (hovered) {
            // Keep the rectangle inside this monitor for the frozen-image crop.
            const x = Math.max(0, hovered.x)
            const y = Math.max(0, hovered.y)
            const width = Math.min(window.innerWidth, hovered.x + hovered.width) - x
            const height = Math.min(window.innerHeight, hovered.y + hovered.height) - y
            void invoke("capture_window", { overlayId: id, windowId: hovered.id, x, y, width, height, viewportWidth: window.innerWidth })
          }
        } else setStart({ x: event.clientX, y: event.clientY })
      }}
      onMouseUp={(event) => event.button === 0 && mode === "area" && finish()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <img
        ref={image}
        src={captureUrl(id)}
        alt=""
        draggable={false}
        className="absolute inset-0 size-full"
        onError={cancel}
        onLoad={(event) => {
          setScale(event.currentTarget.naturalWidth / window.innerWidth)
          const win = getCurrentWindow()
          void win.show().then(() => win.setFocus())
        }}
      />

      {hovered ? (
        <div
          className="pointer-events-none absolute rounded-[10px] bg-[#f07a2b]/15 outline outline-2 outline-[#f07a2b]"
          style={{
            left: hovered.x,
            top: hovered.y,
            width: hovered.width,
            height: hovered.height,
            boxShadow: "0 0 0 100vmax rgb(0 0 0 / 0.35)",
          }}
        />
      ) : selection ? (
        <div
          className="absolute outline outline-1 outline-white/90"
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: selection.height,
            boxShadow: "0 0 0 100vmax rgb(0 0 0 / 0.45)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/30" />
      )}

      {mode === "area" && cursor && !selection && (
        <>
          <div className="pointer-events-none absolute inset-x-0 h-px bg-white/50" style={{ top: cursor.y }} />
          <div className="pointer-events-none absolute inset-y-0 w-px bg-white/50" style={{ left: cursor.x }} />
        </>
      )}

      {mode === "window" && hovered && cursor && (
        <span
          className="pointer-events-none absolute max-w-[420px] truncate rounded-md bg-black/75 px-2 py-0.5 text-xs text-white"
          style={{ left: cursor.x + 16, top: cursor.y + 16 }}
        >
          {label}
        </span>
      )}

      {mode === "area" && cursor && (
        <span
          className="pointer-events-none absolute rounded-md bg-black/75 px-2 py-0.5 font-mono text-[11px] text-white tabular-nums"
          style={{
            left: flipX ? undefined : cursor.x + LABEL_GAP,
            right: flipX ? window.innerWidth - cursor.x + LABEL_GAP : undefined,
            top: flipY ? cursor.y - LABEL_GAP - 20 : cursor.y + LABEL_GAP,
          }}
        >
          {label}
        </span>
      )}
    </div>
  )
}
