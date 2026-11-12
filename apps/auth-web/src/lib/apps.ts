import { authOrigin } from "@evido/auth/client"

/** The Even apps next to this site: todo.<domain>, mail.<domain>, notes.<domain> and the download page. */
export function appLinks() {
  const { hostname, protocol } = new URL(authOrigin())
  if (hostname === "localhost")
    return {
      todo: "http://localhost:3000",
      mail: "http://localhost:3004",
      notes: "http://localhost:3006",
      download: "http://localhost:3002/download/",
    }
  const domain = hostname.replace(/^auth\./, "")
  return {
    todo: `${protocol}//todo.${domain}`,
    mail: `${protocol}//mail.${domain}`,
    notes: `${protocol}//notes.${domain}`,
    download: `${protocol}//${domain}/download/`,
  }
}
