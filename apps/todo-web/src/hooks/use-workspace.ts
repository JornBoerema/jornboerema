import { apiFetch } from "@/lib/api";
import { useEffect, useRef, useState } from "react";
import { watchChannel } from "@evido/realtime/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate } from "react-router";
import { useI18n, type TodoMessages } from "@/i18n";
class SessionExpired extends Error {}
class LinkUnavailable extends Error {}
class NoAccess extends Error {}
import {
  optimisticUpdate,
  type Command,
  type WorkspaceData,
} from "@evido/todo-core/workspace";
type ErrorTexts = TodoMessages["workspace"]["errors"];
async function request<T>(m: ErrorTexts, url: string, options?: RequestInit): Promise<T> {
  const response = await apiFetch(url, { ...options, cache: "no-store" });
  if (response.status === 401) {
    throw new SessionExpired(m.sessionExpired);
  }
  if (response.status === 404 && url.startsWith("/api/shared/")) throw new LinkUnavailable(m.linkUnavailable);
  if (response.status === 404 && url.startsWith("/api/workspace?") && !options?.method) throw new NoAccess(m.noAccess);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? m.noConnection);
  }
  return response.json();
}
export function useWorkspace(
  userId: string,
  workspaceId: string,
  initialData: WorkspaceData,
  realtimeEnabled: boolean,
  shareToken?: string,
) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { t: { workspace: { errors: m } } } = useI18n();
  const [connection, setConnection] = useState(
    realtimeEnabled ? "connecting" : "polling",
  );
  const [online, setOnline] = useState(true);
  const key = shareToken ? ["shared-workspace", shareToken] : ["workspace", userId, workspaceId];
  const endpoint = shareToken
    ? `/api/shared/${shareToken}`
    : `/api/workspace?workspaceId=${encodeURIComponent(workspaceId)}`;
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => request<WorkspaceData>(m, endpoint, { signal }),
    initialData,
    refetchInterval: shareToken ? 5000 : 60000,
    retry: (count, error) =>
      !(error instanceof LinkUnavailable || error instanceof NoAccess) && count < 2,
    refetchOnWindowFocus: "always",
  });
  // Every change is shown immediately and saved in the background. Changes to
  // the same workspace share a scope, so they reach the server one by one and in
  // order (e.g. a new list is created before tasks are added to it).
  const mutationKey = ["workspace-command", ...key];
  const mutation = useMutation({
    mutationKey,
    scope: { id: JSON.stringify(key) },
    mutationFn: (command: Command) =>
      request(m, endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      }),
    onError: (error) => {
      toast.error(error.message);
      if (error instanceof SessionExpired) navigate("/login", { replace: true });
    },
    networkMode: "always",
    // Refetch once the queue is empty; earlier refetches would briefly drop
    // changes that are still waiting to be saved.
    onSettled: () => {
      if (client.isMutating({ mutationKey }) <= 1) void client.invalidateQueries({ queryKey: key });
    },
    retry: false,
  });
  // Unsaved commands, applied on top of the server data. Tracked locally (not
  // via the mutation cache) so a change shows up in the same render it is made.
  const [queued, setQueued] = useState<{ seq: number; command: Command }[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    // Removed from this workspace: reload the list so the switcher falls back.
    if (query.error instanceof NoAccess) {
      toast.error(query.error.message);
      void client.invalidateQueries({ queryKey: ["workspaces", userId] });
    }
  }, [query.error, client, userId]);
  useEffect(() => {
    if (query.error instanceof SessionExpired) navigate("/login", { replace: true });
  }, [query.error, navigate]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    if (!realtimeEnabled) return;
    // Membership changes (invites, removals, renames) arrive on the same channel.
    const refresh = () => {
      void client.invalidateQueries({ queryKey: ["workspace", userId] });
      void client.invalidateQueries({ queryKey: ["workspaces", userId] });
      void client.invalidateQueries({ queryKey: ["workspace-members"] });
    };
    return watchChannel({
      fetchSubscription: async () => {
        const response = await apiFetch("/api/realtime");
        if (!response.ok) throw new Error(`Realtime ${response.status}`);
        return response.json();
      },
      onChange: refresh,
      onStatus: setConnection,
    });
  }, [client, userId, realtimeEnabled]);
  async function run(command: Command) {
    if (!navigator.onLine) {
      toast.error(m.offline);
      return false;
    }
    const entry = { seq: ++seq.current, command };
    const unqueue = () => setQueued((current) => current.filter((item) => item !== entry));
    setQueued((current) => [...current, entry]);
    try {
      await mutation.mutateAsync(command);
      // Saved: keep showing it by writing it into the cached server data before
      // it leaves the queue, so it never flickers back while the refetch runs.
      // Applying a command twice for a moment is harmless (they are idempotent).
      client.setQueryData<WorkspaceData>(key, (current) => current && optimisticUpdate(current, command));
      setTimeout(unqueue, 0);
      return true;
    } catch {
      unqueue();
      return false;
    }
  }
  const data = queued.reduce((state, { command }) => optimisticUpdate(state, command), query.data);
  return {
    data,
    run,
    pending: queued.length > 0,
    online,
    connection,
    error: query.isError,
    unavailable: query.error instanceof LinkUnavailable,
    refresh: query.refetch,
  };
}
