import { useCallback, useEffect, useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { toast } from "sonner"
import { Button } from "@evido/ui/components/button"
import { NativeSelect, NativeSelectOption } from "@evido/ui/components/native-select"
import { SettingsRow, SettingsSection } from "@evido/ui/components/settings-dialog"
import { Switch } from "@evido/ui/components/switch"
import { useTheme, type Theme } from "@evido/ui/lib/theme"
import type { LanguagePreference } from "@evido/i18n/react"
import { Brand } from "./brand"
import { commands, formatShortcut, isMac, shortcutFromEvent, type AfterCapture, type Settings, type Shortcuts } from "./lib"
import { useI18n } from "./i18n"

/** Settings window: shortcuts, what happens after a capture, and general preferences. */
export function SettingsWindow() {
  const { t, language, preference, setPreference } = useI18n()
  const s = t.settings
  const { theme, setTheme } = useTheme()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState<{ key: keyof Shortcuts; message: string } | null>(null)

  useEffect(() => {
    void commands.settings().then(setSettings)
  }, [])

  // The tray menu follows the language chosen here.
  useEffect(() => {
    void commands.setLanguage(language)
  }, [language])

  // Esc closes the window (when not recording a shortcut, which stops it first).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) void getCurrentWindow().close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const update = useCallback(
    async (patch: Partial<Settings>, shortcutKey?: keyof Shortcuts) => {
      if (!settings) return
      try {
        setSettings(await commands.updateSettings({ ...settings, ...patch }))
        if (shortcutKey) setError(null)
      } catch (cause) {
        const [kind, shortcut = ""] = String(cause).split(/:(.*)/s)
        const format = s.errors[kind as "taken" | "duplicate" | "invalid"]
        const message = format ? format(formatShortcut(shortcut)) : s.errors.failed
        if (shortcutKey) setError({ key: shortcutKey, message })
        else toast.error(message)
      }
    },
    [settings, s]
  )

  if (!settings) return <div className="h-full bg-background" />

  const shortcutRows: { key: keyof Shortcuts; label: string }[] = [
    { key: "fullscreen", label: s.fullscreen },
    { key: "area", label: s.area },
    { key: "window", label: s.window },
  ]

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3" data-tauri-drag-region>
        <div className={isMac ? "pl-[80px]" : "pl-1"} data-tauri-drag-region>
          <Brand />
        </div>
        <span className="text-sm text-muted-foreground" data-tauri-drag-region>
          {s.title}
        </span>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-6">
          <p className="px-1 text-sm text-muted-foreground">{isMac ? s.running : s.runningWindows}</p>

          <SettingsSection title={s.shortcuts} description={s.shortcutsHelp}>
            {shortcutRows.map(({ key, label }) => (
              <SettingsRow
                key={key}
                title={label}
                description={error?.key === key ? <span className="text-destructive">{error.message}</span> : undefined}
              >
                <ShortcutRecorder
                  label={s.change(label)}
                  value={settings.shortcuts[key]}
                  onChange={(value) => void update({ shortcuts: { ...settings.shortcuts, [key]: value } }, key)}
                />
              </SettingsRow>
            ))}
          </SettingsSection>

          <SettingsSection title={s.afterCapture} description={s.afterCaptureHelp}>
            <SettingsRow title={s.action} htmlFor="after-capture" description={s.actionHelp[settings.afterCapture]}>
              <NativeSelect
                id="after-capture"
                value={settings.afterCapture}
                onChange={(event) => void update({ afterCapture: event.target.value as AfterCapture })}
              >
                {(["editor", "copy", "save"] as const).map((action) => (
                  <NativeSelectOption key={action} value={action}>
                    {s.actions[action]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </SettingsRow>
            <SettingsRow
              title={s.folder}
              description={<span className="break-all">{settings.saveFolderPath}</span>}
            >
              {settings.saveFolder && (
                <Button variant="ghost" onClick={() => void update({ saveFolder: null })}>
                  {s.useDesktop}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={async () => {
                  const folder = await open({ directory: true, defaultPath: settings.saveFolderPath })
                  if (typeof folder === "string") void update({ saveFolder: folder })
                }}
              >
                {s.choose}
              </Button>
            </SettingsRow>
            <SettingsRow title={s.askWhere} htmlFor="ask-where" description={s.askWhereHelp}>
              <Switch
                id="ask-where"
                checked={settings.askWhereToSave}
                onCheckedChange={(checked) => void update({ askWhereToSave: checked })}
              />
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title={s.general}>
            <SettingsRow title={s.launchAtLogin} htmlFor="launch-at-login" description={s.launchAtLoginHelp}>
              <Switch
                id="launch-at-login"
                checked={settings.launchAtLogin}
                onCheckedChange={async (checked) => {
                  try {
                    const launchAtLogin = await commands.setLaunchAtLogin(checked)
                    setSettings((current) => current && { ...current, launchAtLogin })
                  } catch {
                    toast.error(s.errors.failed)
                  }
                }}
              />
            </SettingsRow>
            <SettingsRow title={s.language} htmlFor="language">
              <NativeSelect
                id="language"
                value={preference}
                onChange={(event) => setPreference(event.target.value as LanguagePreference)}
              >
                {(["auto", "en", "nl"] as const).map((option) => (
                  <NativeSelectOption key={option} value={option}>
                    {s.languages[option]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </SettingsRow>
            <SettingsRow title={s.appearance} htmlFor="appearance">
              <NativeSelect id="appearance" value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
                {(["system", "light", "dark"] as const).map((option) => (
                  <NativeSelectOption key={option} value={option}>
                    {s.themes[option]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </SettingsRow>
          </SettingsSection>
        </div>
      </main>
    </div>
  )
}

/**
 * Shows a shortcut; click it and press a new combination. The app's own
 * shortcuts are paused meanwhile, so pressing the current one doesn't capture.
 */
function ShortcutRecorder({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { t } = useI18n()
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!recording) return
    void commands.suspendShortcuts()
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      if (event.key === "Escape") return setRecording(false)
      const shortcut = shortcutFromEvent(event)
      if (!shortcut) return
      setRecording(false)
      if (shortcut !== value) onChange(shortcut)
    }
    // Capture phase: before the window's own Esc-to-close.
    window.addEventListener("keydown", onKey, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      // Saving a new shortcut registers all of them again; this covers cancel.
      void commands.resumeShortcuts()
    }
  }, [recording, value, onChange])

  return (
    <Button
      variant={recording ? "secondary" : "outline"}
      className="min-w-28 justify-center tracking-wider tabular-nums"
      aria-label={label}
      title={recording ? t.settings.recordHelp : label}
      onClick={() => setRecording((current) => !current)}
      onBlur={() => setRecording(false)}
    >
      {recording ? t.settings.record : formatShortcut(value)}
    </Button>
  )
}
