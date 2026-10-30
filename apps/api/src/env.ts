import { trustedOrigins } from "@evido/auth/server"

export const env = {
  port: Number(process.env.PORT ?? process.env.API_PORT ?? 4000),
  apiUrl: (process.env.BETTER_AUTH_URL ?? "http://localhost:4000").replace(/\/$/, ""),
  todoWebUrl: (process.env.TODO_WEB_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  trustedOrigins: trustedOrigins(),
  realtimeEnabled: !!process.env.ABLY_API_KEY,
}
