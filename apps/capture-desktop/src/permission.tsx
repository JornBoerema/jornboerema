import { getCurrentWindow } from "@tauri-apps/api/window"
import { Button } from "@evido/ui/components/button"
import { commands } from "./lib"
import { useI18n } from "./i18n"

/** Shown when macOS has not granted the Screen Recording permission yet. */
export function Permission() {
  const { t } = useI18n()
  return (
    <div className="flex h-full flex-col justify-center gap-5 p-8 pt-12" data-tauri-drag-region>
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold">{t.permission.title}</h1>
        <p className="text-sm text-muted-foreground">{t.permission.body}</p>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => void commands.openScreenRecordingSettings()}>{t.permission.open}</Button>
        <Button variant="ghost" onClick={() => void getCurrentWindow().close()}>{t.permission.later}</Button>
      </div>
    </div>
  )
}
