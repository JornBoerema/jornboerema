import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { setWebOrigins } from "@evido/auth/client"
import "./tailwind.css"
import "@evido/ui/sidebar.css"
import "@evido/ui/auth.css"
import "@evido/ui/spotlight.css"
import "./desktop.css"
import { Desktop } from "./desktop"

// Links in e-mails and hand-offs to the browser go to the web apps; signing in to the account site.
setWebOrigins({
  todo: import.meta.env.VITE_TODO_WEB_URL,
  mail: import.meta.env.VITE_MAIL_WEB_URL,
  auth: import.meta.env.VITE_AUTH_URL,
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Desktop />
  </StrictMode>
)
