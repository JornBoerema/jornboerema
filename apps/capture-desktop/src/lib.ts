import { convertFileSrc, invoke } from "@tauri-apps/api/core"

export type CaptureInfo = { width: number; height: number; scaleFactor: number }

export type AfterCapture = "editor" | "copy" | "save"

export type Shortcuts = { fullscreen: string; area: string; window: string }

/** Mirrors `settings::Settings` in Rust (plus what lives outside its file). */
export type Settings = {
  shortcuts: Shortcuts
  afterCapture: AfterCapture
  saveFolder: string | null
  askWhereToSave: boolean
  launchAtLogin: boolean
  /** Where screenshots actually go (the Desktop when no folder is chosen). */
  saveFolderPath: string
}

/** URL of a capture, served by the Rust `capture://` protocol. */
export const captureUrl = (id: string) => convertFileSrc(id, "capture")

export const commands = {
  info: (id: string) => invoke<CaptureInfo>("capture_info", { id }),
  copy: (id: string) => invoke<void>("copy_capture", { id }),
  save: (id: string, path: string) => invoke<void>("save_capture", { id, path }),
  openScreenRecordingSettings: () => invoke<void>("open_screen_recording_settings"),
  settings: () => invoke<Settings>("get_settings"),
  updateSettings: ({ launchAtLogin: _, saveFolderPath: __, ...settings }: Settings) =>
    invoke<Settings>("update_settings", { settings }),
  setLaunchAtLogin: (enabled: boolean) => invoke<boolean>("set_launch_at_login", { enabled }),
  setLanguage: (language: string) => invoke<void>("set_language", { language }),
  suspendShortcuts: () => invoke<void>("suspend_shortcuts"),
  resumeShortcuts: () => invoke<void>("resume_shortcuts"),
  openSettings: () => invoke<void>("open_settings"),
}

export const isMac = navigator.userAgent.includes("Mac")

const MAC_SYMBOLS: Record<string, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Cmd: "⌘", Super: "⌘" }

/** "Alt+Shift+1" → "⌥⇧1" on macOS, unchanged elsewhere. */
export function formatShortcut(shortcut: string) {
  if (!isMac) return shortcut
  const parts = shortcut.split("+")
  const key = parts.pop() ?? ""
  const order = ["Ctrl", "Alt", "Shift", "Cmd", "Super"]
  const modifiers = parts.sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((m) => MAC_SYMBOLS[m] ?? m)
  return modifiers.join("") + (key === "Space" ? "Space" : key)
}

const ARROWS: Record<string, string> = { ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" }

/**
 * A pressed key combination in Tauri's accelerator notation, or null while it
 * is incomplete (only modifiers) or not usable as a global shortcut.
 */
export function shortcutFromEvent(event: KeyboardEvent): string | null {
  const { code } = event
  const key = /^Key[A-Z]$/.test(code)
    ? code.slice(3)
    : /^Digit\d$/.test(code)
      ? code.slice(5)
      : /^F\d{1,2}$/.test(code)
        ? code
        : code === "Space"
          ? "Space"
          : ARROWS[code]
  if (!key) return null
  const modifiers = [
    event.ctrlKey && "Ctrl",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    event.metaKey && (isMac ? "Cmd" : "Super"),
  ].filter(Boolean) as string[]
  // Function keys may stand alone; anything else needs a modifier.
  if (!modifiers.length && !/^F\d/.test(key)) return null
  return [...modifiers, key].join("+")
}

/** "2026-10-30 at 19.45.12", safe for file names on macOS and Windows. */
export function timestamp(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`
}
