import { authOrigin } from "@evido/auth/client"

/** The Even apps next to this site, each at its place in the Even web app (app.<domain>), and the download page. */
export function appLinks() {
  const { hostname, protocol } = new URL(authOrigin())
  const local = hostname === "localhost"
  const domain = hostname.replace(/^auth\./, "")
  const app = local ? "http://localhost:3007" : `${protocol}//app.${domain}`
  return {
    todo: `${app}/todo`,
    mail: `${app}/mail`,
    notes: `${app}/notes`,
    download: local ? "http://localhost:3002/download/" : `${protocol}//${domain}/download/`,
  }
}
