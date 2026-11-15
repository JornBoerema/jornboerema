import { useCallback, useEffect } from "react"
import { useNavigate, useSearchParams } from "react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  WorkspaceCommand,
  WorkspaceMembers,
  WorkspaceSummary,
} from "@evido/todo-core/workspaces"
import { apiFetch } from "@/lib/api"
import { useI18n } from "@/i18n"
import { useOrganizations } from "@evido/ui/components/organizations"

async function getJson<T>(path: string, fallbackError: string): Promise<T> {
  const response = await apiFetch(path)
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error ?? fallbackError)
  return body
}

export function useWorkspaces(userId: string, enabled = true) {
  const { t } = useI18n()
  return useQuery({
    enabled: enabled && !!userId,
    queryKey: ["workspaces", userId],
    queryFn: () => getJson<WorkspaceSummary[]>("/api/workspaces", t.workspace.errors.noConnection),
  })
}

export function useWorkspaceMembers(workspaceId: string) {
  const { t } = useI18n()
  return useQuery({
    queryKey: ["workspace-members", workspaceId],
    queryFn: () => getJson<WorkspaceMembers>(`/api/workspaces/${workspaceId}/members`, t.workspace.errors.noConnection),
  })
}

/** Runs a workspace command and refreshes everything that depends on it. */
export function useWorkspaceCommand(userId: string) {
  const client = useQueryClient()
  // The rail's picker keeps its own list of organizations.
  const refreshShell = useOrganizations()?.refresh
  const { t: { workspace: { errors: t } } } = useI18n()
  return useCallback(
    async (command: WorkspaceCommand) => {
      const response = await apiFetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      })
      const body = await response.json().catch(() => null)
      await Promise.all([
        client.invalidateQueries({ queryKey: ["workspaces", userId] }),
        client.invalidateQueries({ queryKey: ["workspace-members"] }),
        refreshShell?.(),
      ])
      if (!response.ok) throw new Error(body?.error ?? t.failed)
    },
    [client, userId, t, refreshShell]
  )
}

/**
 * The active organization: the one picked in the Even shell's rail. A
 * `?workspace=<id>` link (from the dashboard, or after accepting an invitation)
 * switches to it once.
 */
export function useActiveWorkspace(workspaces: WorkspaceSummary[]) {
  const navigate = useNavigate()
  const organizations = useOrganizations()
  const [params, setParams] = useSearchParams()
  const fromUrl = params.get("workspace")
  const pick = organizations?.select
  useEffect(() => {
    if (!fromUrl) return
    if (workspaces.some((w) => w.id === fromUrl)) pick?.(fromUrl)
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete("workspace")
        return next
      },
      { replace: true }
    )
  }, [fromUrl, setParams, pick, workspaces])
  const wanted = fromUrl ?? organizations?.active.id
  const active = workspaces.find((w) => w.id === wanted) ?? workspaces.find((w) => w.personal) ?? workspaces[0]
  const select = useCallback(
    (id: string) => {
      pick?.(id)
      // Lists belong to one organization: start again at its first one.
      navigate({ search: "" })
    },
    [navigate, pick]
  )
  return { active, select }
}
