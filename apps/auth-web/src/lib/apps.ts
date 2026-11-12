import { authOrigin } from "@evido/auth/client"

/** The Even apps next to this site: todo.<domain>, mail.<domain> and the download page. */
export function appLinks() {
  const { hostname, protocol } = new URL(authOrigin())
  if (hostname === "localhost")
    return {
      todo: "http://localhost:3000",
      mail: "http://localhost:3004",
      download: "http://localhost:3002/download/",
    }
  const domain = hostname.replace(/^auth\./, "")
  return {
    todo: `${protocol}//todo.${domain}`,
    mail: `${protocol}//mail.${domain}`,
    download: `${protocol}//${domain}/download/`,
  }
}
