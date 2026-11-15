import { appUrl } from "@even/auth/client"

/** The Even apps, each at its place in this web app, and the download page on the website. */
export function appLinks() {
  const { hostname, protocol } = window.location
  const local = hostname === "localhost" || hostname === "127.0.0.1"
  return {
    todo: appUrl("todo"),
    mail: appUrl("mail"),
    notes: appUrl("notes"),
    download: local ? "http://localhost:3002/download/" : `${protocol}//${hostname.replace(/^app\./, "")}/download/`,
  }
}
