import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@even/ui/globals.css"
import "@even/ui/sidebar.css"
import "@even/ui/auth.css"
import "./admin.css"
import { App } from "./app"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
