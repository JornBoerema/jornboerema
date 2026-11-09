import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@evido/ui/globals.css"
import "@evido/ui/sidebar.css"
import "./app.css"
import { App } from "./app"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
