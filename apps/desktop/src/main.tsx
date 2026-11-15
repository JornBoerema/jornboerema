import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { setWebOrigin } from "@evido/auth/client"
import "./tailwind.css"
import "@evido/ui/sidebar.css"
import "@evido/ui/auth.css"
import "@evido/ui/spotlight.css"
import "@evido/shell/shell.css"
import { Desktop } from "./desktop"
import { keepMailOnDisk } from "./mail-storage"

// Links in e-mails, hand-offs to the browser and signing in all go to the Even web app.
setWebOrigin(import.meta.env.VITE_WEB_URL)

// Before the mail mounts: it reads its cache from the app's database from the start.
keepMailOnDisk()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Desktop />
  </StrictMode>
)
