import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@evido/ui/globals.css"
import { ThemeProvider } from "@evido/ui/lib/theme"
import { Toaster } from "@evido/ui/components/sonner"
import { I18nProvider } from "./i18n"
import { Editor } from "./editor"
import { Permission } from "./permission"
import { Overlay } from "./overlay"
import { SettingsWindow } from "./settings"

// Each window loads this page; the query string says which screen it is.
const params = new URLSearchParams(window.location.search)
const captureId = params.get("capture")
const overlayId = params.get("overlay")

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        {overlayId ? (
          <Overlay id={overlayId} mode={params.get("mode") === "window" ? "window" : "area"} />
        ) : captureId ? (
          <Editor id={captureId} />
        ) : params.has("settings") ? (
          <SettingsWindow />
        ) : (
          <Permission />
        )}
        <Toaster position="bottom-center" />
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>
)
