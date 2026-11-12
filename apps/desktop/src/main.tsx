import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { setWebOrigins } from "@evido/auth/client"
import "./tailwind.css"
import "@evido/ui/sidebar.css"
import "@evido/ui/auth.css"
import "@evido/ui/spotlight.css"
import "./desktop.css"
import { Desktop } from "./desktop"
import { keepMailOnDisk } from "./mail-storage"

// Links in e-mails and hand-offs to the browser go to the web apps; signing in to the account site.
setWebOrigins({
  todo: import.meta.env.VITE_TODO_WEB_URL,
  mail: import.meta.env.VITE_MAIL_WEB_URL,
  notes: import.meta.env.VITE_NOTES_WEB_URL,
  auth: import.meta.env.VITE_AUTH_URL,
})

// Before the mail mounts: it reads its cache from the app's database from the start.
keepMailOnDisk()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Desktop />
  </StrictMode>
)
