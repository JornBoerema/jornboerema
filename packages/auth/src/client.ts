import { createAuthClient } from "better-auth/react"
import { oauthProviderClient } from "@better-auth/oauth-provider/client"

/** Browser auth client for every Evido React app; `baseURL` is the API origin. */
export function createEvidoAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    fetchOptions: { credentials: "include" },
    plugins: [oauthProviderClient()],
  })
}

export type EvidoAuthClient = ReturnType<typeof createEvidoAuthClient>
