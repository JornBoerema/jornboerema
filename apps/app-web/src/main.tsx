import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./tailwind.css"
import "@evido/ui/sidebar.css"
import "@evido/ui/auth.css"
import "@evido/ui/spotlight.css"
import "@evido/shell/shell.css"
import "./app.css"
import { App } from "./app"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
