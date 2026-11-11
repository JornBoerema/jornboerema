import { useEffect } from "react"
import { toast } from "sonner"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { currentLanguage } from "@evido/i18n/react"

const TEXTS = {
  en: {
    ready: (version: string) => `Even ${version} is ready`,
    description: "Restart to use the new version.",
    restart: "Restart",
    failed: "The update could not be installed.",
  },
  nl: {
    ready: (version: string) => `Even ${version} staat klaar`,
    description: "Herstart om de nieuwe versie te gebruiken.",
    restart: "Herstarten",
    failed: "De update kon niet worden geïnstalleerd.",
  },
}

/** Offers a downloaded update; it installs only when you choose to restart. */
export function useUpdateNotice() {
  useEffect(() => {
    const offer = (version: string) => {
      const t = TEXTS[currentLanguage()] ?? TEXTS.en
      toast(t.ready(version), {
        id: "update",
        description: t.description,
        duration: Infinity,
        action: {
          label: t.restart,
          onClick: () => invoke("install_update").catch(() => toast.error(t.failed)),
        },
      })
    }
    void invoke<string | null>("ready_update").then((version) => version && offer(version))
    const unlisten = listen<string>("update-ready", (event) => offer(event.payload))
    return () => void unlisten.then((stop) => stop())
  }, [])
}
