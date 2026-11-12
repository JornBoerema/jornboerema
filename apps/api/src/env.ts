import { trustedOrigins } from "@evido/auth/server"

export const env = {
  port: Number(process.env.PORT ?? process.env.API_PORT ?? 4000),
  apiUrl: (process.env.BETTER_AUTH_URL ?? "http://localhost:4000").replace(/\/$/, ""),
  todoWebUrl: (process.env.TODO_WEB_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  mailWebUrl: (process.env.MAIL_WEB_URL ?? "http://localhost:3004").replace(/\/$/, ""),
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
  realtimeEnabled: !!process.env.ABLY_API_KEY,
}
