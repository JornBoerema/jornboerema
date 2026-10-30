import { useSearchParams } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { authClient } from "@/lib/auth-client"
import { useTitle } from "@/lib/use-title"
import { useI18n } from "@/i18n"
import { OAuthConsent } from "@/components/oauth-consent"
import { Skeleton } from "@evido/ui/components/skeleton"

export function ConsentPage() {
  const t = useI18n().t.auth.consent
  useTitle(t.pageTitle)
  const [params] = useSearchParams()
  const clientId = params.get("client_id")
  const client = useQuery({
    queryKey: ["oauth-client", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const result = await authClient.oauth2.publicClient({ query: { client_id: clientId! } })
      return result.data ?? null
    },
  })
  if (clientId && client.isPending) return <Skeleton className="h-80 w-full max-w-sm" />
  if (!client.data)
    return <p>{t.startFromClient}</p>
  return <OAuthConsent clientName={client.data.client_name || t.fallbackClient} />
}
