import { trustedOrigins } from "@evido/auth/server"
import { realtimeEnabled } from "@evido/realtime/server"

const appWebUrl = (process.env.APP_WEB_URL ?? "http://localhost:3007").replace(/\/$/, "")

export const env = {
  port: Number(process.env.PORT ?? process.env.API_PORT ?? 4000),
  apiUrl: (process.env.BETTER_AUTH_URL ?? "http://localhost:4000").replace(/\/$/, ""),
  /** The Even web app (app.jornboerema.nl): the apps under /mail, /todo and /notes, signing in and the account. */
  appWebUrl,
  todoWebUrl: `${appWebUrl}/todo`,
  mailWebUrl: `${appWebUrl}/mail`,
  /** jornboerema.nl, whose /admin manages every app. */
  adminWebUrl: (process.env.ADMIN_WEB_URL ?? "http://localhost:3002").replace(/\/$/, ""),
  /** Who may use the admin portal, by verified sign-in email. */
  adminEmails: (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
  /** The repo the admin dashboard reports on, and a read-only token so GitHub doesn't rate-limit it. */
  githubRepo: process.env.GITHUB_REPO ?? "JornBoerema/jornboerema",
  githubToken: process.env.GITHUB_TOKEN ?? "",
  trustedOrigins: trustedOrigins(),
  realtimeEnabled: realtimeEnabled(),
}
