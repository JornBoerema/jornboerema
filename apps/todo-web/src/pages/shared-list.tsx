import { useParams } from "react-router"
import { useQuery } from "@tanstack/react-query"
import type { WorkspaceData } from "@evido/todo-core/workspace"
import { apiFetch } from "@/lib/api"
import { useTitle } from "@/lib/use-title"
import { Brand } from "@/components/brand"
import { WorkspaceApp } from "@/components/workspace-app"
import { PageLoading } from "@/components/page-loading"
import { PageError } from "@/components/page-error"

class Unavailable extends Error {}

export function SharedListPage() {
  const { token = "" } = useParams()
  useTitle("Gedeelde lijst")
  const query = useQuery({
    queryKey: ["shared-workspace", token],
    queryFn: async () => {
      const response = await apiFetch(`/api/gedeeld/${token}`)
      if (response.status === 404) throw new Unavailable()
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return (await response.json()) as WorkspaceData
    },
    retry: (count, error) => !(error instanceof Unavailable) && count < 2,
  })
  if (query.error instanceof Unavailable)
    return (
      <main className="account-content">
        <Brand />
        <div className="account-heading">
          <h1>Deze link is niet meer beschikbaar</h1>
          <p>Vraag de eigenaar om een nieuwe link naar de lijst.</p>
        </div>
      </main>
    )
  if (query.isError) return <PageError onRetry={() => void query.refetch()} />
  if (!query.data) return <PageLoading />
  return <WorkspaceApp initialData={query.data} realtimeEnabled={false} shareToken={token} />
}
