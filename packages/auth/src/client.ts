import { createAuthClient } from "better-auth/react"
import { oauthProviderClient } from "@better-auth/oauth-provider/client"

/**
 * Browser auth client for every Evido React app; `baseURL` is the API origin.
 * `language` is sent as Accept-Language so auth e-mails use the user's language.
 */
export function createEvidoAuthClient(
  baseURL: string,
  options: { language?: () => string } = {}
) {
  return createAuthClient({
    baseURL,
    fetchOptions: {
      credentials: "include",
      onRequest: (context) => {
        if (options.language) context.headers.set("Accept-Language", options.language())
      },
    },
    plugins: [oauthProviderClient()],
  })
}

export type EvidoAuthClient = ReturnType<typeof createEvidoAuthClient>
