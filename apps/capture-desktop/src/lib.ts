import { convertFileSrc, invoke } from "@tauri-apps/api/core"

export type CaptureInfo = { width: number; height: number; scaleFactor: number }

/** URL of a capture, served by the Rust `capture://` protocol. */
export const captureUrl = (id: string) => convertFileSrc(id, "capture")

export const commands = {
  info: (id: string) => invoke<CaptureInfo>("capture_info", { id }),
  copy: (id: string) => invoke<void>("copy_capture", { id }),
  save: (id: string, path: string) => invoke<void>("save_capture", { id, path }),
  openScreenRecordingSettings: () => invoke<void>("open_screen_recording_settings"),
}

/** "2026-10-30 at 19.45.12", safe for file names on macOS and Windows. */
export function timestamp(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`
}
