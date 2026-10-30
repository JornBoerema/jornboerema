import { useQuery } from "@tanstack/react-query"
import type { WorkspaceData } from "@evido/todo-core/workspace"
import type { WorkspaceSummary } from "@evido/todo-core/workspaces"
import { apiFetch } from "@/lib/api"
import { RequireSession, type SessionUser } from "@/lib/session"
import { useActiveWorkspace, useWorkspaces } from "@/lib/workspaces"
import { WorkspaceApp } from "@/components/workspace-app"
import { PageLoading } from "@/components/page-loading"
import { PageError } from "@/components/page-error"

async function getJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

function ActiveWorkspace({ user, workspaces }: { user: SessionUser; workspaces: WorkspaceSummary[] }) {
  const { active, select } = useActiveWorkspace(workspaces)
  const workspace = useQuery({
    queryKey: ["workspace", user.id, active.id],
    queryFn: () =>
      getJson<WorkspaceData>(`/api/workspace?workspaceId=${encodeURIComponent(active.id)}`),
  })
  const config = useQuery({
    queryKey: ["api-config"],
    queryFn: () => getJson<{ realtime: boolean }>("/api/config"),
    staleTime: Infinity,
  })
  if (workspace.isError) return <PageError onRetry={() => void workspace.refetch()} />
  if (!workspace.data || config.isPending) return <PageLoading />
  return (
    <WorkspaceApp
      key={active.id}
      user={{ id: user.id, name: user.name, email: user.email }}
      workspaces={workspaces}
      activeWorkspace={active}
      onSelectWorkspace={select}
      initialData={workspace.data}
      realtimeEnabled={!!config.data?.realtime}
    />
  )
}

function Home({ user }: { user: SessionUser }) {
  const workspaces = useWorkspaces(user.id)
  if (workspaces.isError) return <PageError onRetry={() => void workspaces.refetch()} />
  if (!workspaces.data) return <PageLoading />
  return <ActiveWorkspace user={user} workspaces={workspaces.data} />
}

export function HomePage() {
  return <RequireSession>{(user) => <Home user={user} />}</RequireSession>
}
