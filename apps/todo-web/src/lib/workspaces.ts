import { useCallback, useEffect } from "react"
import { useNavigate, useSearchParams } from "react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  WorkspaceCommand,
  WorkspaceMembers,
  WorkspaceSummary,
} from "@evido/todo-core/workspaces"
import { apiFetch } from "@/lib/api"

async function getJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path)
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error ?? "Geen verbinding. Probeer het opnieuw.")
  return body
}

export function useWorkspaces(userId: string) {
  return useQuery({
    queryKey: ["workspaces", userId],
    queryFn: () => getJson<WorkspaceSummary[]>("/api/workspaces"),
  })
}

export function useWorkspaceMembers(workspaceId: string) {
  return useQuery({
    queryKey: ["workspace-members", workspaceId],
    queryFn: () => getJson<WorkspaceMembers>(`/api/workspaces/${workspaceId}/members`),
  })
}

/** Runs a workspace command and refreshes everything that depends on it. */
export function useWorkspaceCommand(userId: string) {
  const client = useQueryClient()
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
      ])
      if (!response.ok) throw new Error(body?.error ?? "Dit is niet gelukt. Probeer het opnieuw.")
    },
    [client, userId]
  )
}

const STORAGE_KEY = "evido.todo.workspace"

/**
 * The active workspace is remembered per browser. A `?workspace=<id>` link
 * (e.g. after accepting an invitation) switches to it once.
 */
export function useActiveWorkspace(workspaces: WorkspaceSummary[]) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const fromUrl = params.get("workspace")
  useEffect(() => {
    if (!fromUrl) return
    localStorage.setItem(STORAGE_KEY, fromUrl)
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete("workspace")
        return next
      },
      { replace: true }
    )
  }, [fromUrl, setParams])
  // Selecting always navigates, so reading storage during render stays current.
  const wanted = fromUrl ?? localStorage.getItem(STORAGE_KEY)
  const active = workspaces.find((w) => w.id === wanted) ?? workspaces[0]
  const select = useCallback(
    (id: string) => {
      localStorage.setItem(STORAGE_KEY, id)
      // Lists belong to one workspace: go back to its overview.
      navigate({ search: "" })
    },
    [navigate]
  )
  return { active, select }
}
