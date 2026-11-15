import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./tailwind.css"
import "@even/ui/sidebar.css"
import "@even/ui/auth.css"
import "@even/ui/spotlight.css"
import "@even/shell/shell.css"
import "./app.css"
import { App } from "./app"
import { countPageViews } from "./stats"

countPageViews()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
