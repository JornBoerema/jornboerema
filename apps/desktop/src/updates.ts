import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { currentLanguage } from "@evido/i18n/react"
import type { ReadyUpdate } from "@evido/ui/components/update-button"

const TEXTS = {
  en: { label: "Restart to update", restarting: "Restarting…" },
  nl: { label: "Herstart om bij te werken", restarting: "Herstarten…" },
}

const install = () => invoke<void>("install_update")

/**
 * The downloaded update, for the "Restart to update" button in each app's
 * sidebar. It installs only when that button is clicked.
 */
export function useReadyUpdate(): ReadyUpdate | null {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    void invoke<string | null>("ready_update").then((ready) => ready && setVersion(ready))
    const unlisten = listen<string>("update-ready", (event) => setVersion(event.payload))
    return () => void unlisten.then((stop) => stop())
  }, [])
  if (!version) return null
  return { version, ...(TEXTS[currentLanguage()] ?? TEXTS.en), install }
}
