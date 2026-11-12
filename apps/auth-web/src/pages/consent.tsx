import { useState } from "react"
import { useSearchParams } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@evido/ui/components/button"
import { Skeleton } from "@evido/ui/components/skeleton"
import { useI18n } from "@/i18n"
import { authClient } from "@/lib/auth-client"
import { useTitle } from "@/lib/use-title"

/** OAuth consent for MCP clients such as ChatGPT; Better Auth sends them here. */
export function ConsentPage() {
  const t = useI18n().t.consent
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
  if (!client.data) return <p>{t.startFromClient}</p>
  return <Consent clientName={client.data.client_name || t.fallbackClient} />
}

function Consent({ clientName }: { clientName: string }) {
  const { t: all } = useI18n()
  const t = all.consent
  const [params] = useSearchParams()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  async function decide(accept: boolean) {
    setPending(true)
    setError("")
    try {
      const result = await authClient.oauth2.consent({ accept })
      if (result.error) {
        setError(t.failed)
        setPending(false)
      }
      // Better Auth follows the signed provider redirect automatically.
    } catch {
      setError(all.common.noConnection)
      setPending(false)
    }
  }
  return (
    <section className="auth-form">
      <div className="flex flex-col gap-2">
        <h1>{t.title}</h1>
        <p className="text-muted-foreground">{t.description(clientName)}</p>
      </div>
      <ul className="list-disc space-y-2 pl-5 text-sm">
        {(params.get("scope") ?? "")
          .split(" ")
          .filter(Boolean)
          .map((scope) => (
            <li key={scope}>{t.scopes[scope] ?? scope}</li>
          ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <Button variant="outline" disabled={pending} onClick={() => void decide(false)}>
          {all.common.cancel}
        </Button>
        <Button disabled={pending} onClick={() => void decide(true)}>
          {t.allow}
        </Button>
      </div>
    </section>
  )
}
