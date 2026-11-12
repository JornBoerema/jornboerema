import { useEffect } from "react"
import { useParams } from "react-router"
import { appOrigin } from "@evido/auth/client"
import { useQuery } from "@tanstack/react-query"
import type { WorkspaceData } from "@evido/todo-core/workspace"
import { apiFetch } from "@/lib/api"
import { useTitle } from "@/lib/use-title"
import { useI18n } from "@/i18n"
import { Brand } from "@/components/brand"
import { WorkspaceApp } from "@/components/workspace-app"
import { PageLoading } from "@/components/page-loading"
import { PageError } from "@/components/page-error"

class Unavailable extends Error {}

export function SharedListPage() {
  const { token = "" } = useParams()
  const t = useI18n().t.common.sharedList
  useTitle(t.title)
  const query = useQuery({
    queryKey: ["shared-workspace", token],
    queryFn: async () => {
      const response = await apiFetch(`/api/shared/${token}`)
      if (response.status === 404) throw new Unavailable()
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return (await response.json()) as WorkspaceData
    },
    retry: (count, error) => !(error instanceof Unavailable) && count < 2,
  })
  // Notes moved to Even noteren; links shared before then still point here.
  const isNote = query.data?.lists[0]?.kind === "note"
  useEffect(() => {
    if (isNote) window.location.replace(new URL(`/shared/${token}`, appOrigin("notes")).toString())
  }, [isNote, token])
  if (query.error instanceof Unavailable)
    return (
      <main className="account-content">
        <Brand />
        <div className="account-heading">
          <h1>{t.unavailableTitle}</h1>
          <p>{t.unavailableDescription}</p>
        </div>
      </main>
    )
  if (query.isError) return <PageError onRetry={() => void query.refetch()} />
  if (!query.data || isNote) return <PageLoading />
  return <WorkspaceApp initialData={query.data} realtimeEnabled={false} shareToken={token} />
}
