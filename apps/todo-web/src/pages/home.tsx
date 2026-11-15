import { useInDesktop } from "@even/ui/components/app-switcher"
import { useOrganizations } from "@even/ui/components/organizations"
import { useQuery } from "@tanstack/react-query"
import type { WorkspaceData } from "@even/todo-core/workspace"
import type { WorkspaceSummary } from "@even/todo-core/workspaces"
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
  // In the Even shell the rail already has them; the app follows its choice.
  const inShell = useInDesktop()
  const shell = useOrganizations()
  const workspaces = useWorkspaces(user.id, !inShell)
  if (shell) return <ActiveWorkspace user={user} workspaces={shell.organizations} />
  if (inShell) return <PageLoading />
  if (workspaces.isError) return <PageError onRetry={() => void workspaces.refetch()} />
  if (!workspaces.data) return <PageLoading />
  return <ActiveWorkspace user={user} workspaces={workspaces.data} />
}

export function HomePage() {
  return <RequireSession>{(user) => <Home user={user} />}</RequireSession>
}
