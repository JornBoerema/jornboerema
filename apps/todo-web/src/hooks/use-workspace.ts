import { apiFetch } from "@/lib/api";
import { useEffect, useRef, useState } from "react";
import { Realtime } from "ably";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate } from "react-router";
class SessionExpired extends Error {}
class LinkUnavailable extends Error {}
class NoAccess extends Error {}
import {
  optimisticUpdate,
  type Command,
  type WorkspaceData,
} from "@evido/todo-core/workspace";
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await apiFetch(url, { ...options, cache: "no-store" });
  if (response.status === 401) {
    throw new SessionExpired("Log opnieuw in.");
  }
  if (response.status === 404 && url.startsWith("/api/gedeeld/")) throw new LinkUnavailable("Deze link is niet meer beschikbaar of geeft geen bewerkrechten.");
  if (response.status === 404 && url.startsWith("/api/workspace?") && !options?.method) throw new NoAccess("Je hebt geen toegang meer tot deze workspace.");
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? "Geen verbinding. Probeer het opnieuw.");
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
  const [connection, setConnection] = useState(
    realtimeEnabled ? "connecting" : "polling",
  );
  const [online, setOnline] = useState(true);
  const lock = useRef(false);
  const key = shareToken ? ["shared-workspace", shareToken] : ["workspace", userId, workspaceId];
  const endpoint = shareToken
    ? `/api/gedeeld/${shareToken}`
    : `/api/workspace?workspaceId=${encodeURIComponent(workspaceId)}`;
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => request<WorkspaceData>(endpoint, { signal }),
    initialData,
    refetchInterval: shareToken ? 5000 : 60000,
    retry: (count, error) =>
      !(error instanceof LinkUnavailable || error instanceof NoAccess) && count < 2,
    refetchOnWindowFocus: "always",
  });
  const mutation = useMutation({
    mutationFn: (command: Command) =>
      request(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      }),
    onError: (error) => {
      toast.error(error.message);
      if (error instanceof SessionExpired) navigate("/inloggen", { replace: true });
    },
    networkMode: "always",
    onSettled: () => client.invalidateQueries({ queryKey: key }),
    retry: false,
  });
  useEffect(() => {
    // Removed from this workspace: reload the list so the switcher falls back.
    if (query.error instanceof NoAccess) {
      toast.error(query.error.message);
      void client.invalidateQueries({ queryKey: ["workspaces", userId] });
    }
  }, [query.error, client, userId]);
  useEffect(() => {
    if (query.error instanceof SessionExpired) navigate("/inloggen", { replace: true });
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
    const realtime = new Realtime({
      authCallback: (_params, callback) => {
        apiFetch("/api/realtime")
          .then(async (response) => {
            if (!response.ok) throw new Error("Realtime niet beschikbaar.");
            callback(null, await response.json());
          })
          .catch((error: Error) => callback(error.message, null));
      },
      autoConnect: false,
    });
    // Membership changes (invites, removals, renames) arrive on the same channel.
    const refresh = () => {
      void client.invalidateQueries({ queryKey: ["workspace", userId] });
      void client.invalidateQueries({ queryKey: ["workspaces", userId] });
      void client.invalidateQueries({ queryKey: ["workspace-members"] });
    };
    const changed = () => {
      setConnection(realtime.connection.state);
      if (realtime.connection.state === "connected") refresh();
    };
    realtime.connection.on(changed);
    const channel = realtime.channels.get(`workspace:${userId}`);
    channel.on("attached", refresh);
    void channel
      .subscribe("changed", refresh)
      .catch(() => setConnection("disconnected"));
    realtime.connect();
    return () => {
      channel.unsubscribe();
      channel.off();
      realtime.connection.off();
      realtime.close();
    };
  }, [client, userId, realtimeEnabled]);
  async function run(command: Command) {
    if (lock.current) return false;
    if (!navigator.onLine) {
      toast.error("Je bent offline. Maak verbinding voordat je iets wijzigt.");
      return false;
    }
    lock.current = true;
    try {
      await mutation.mutateAsync(command);
      return true;
    } catch {
      return false;
    } finally {
      lock.current = false;
    }
  }
  const data =
    mutation.isPending && mutation.variables
      ? optimisticUpdate(query.data, mutation.variables)
      : query.data;
  return {
    data,
    run,
    pending: mutation.isPending,
    online,
    connection,
    error: query.isError,
    unavailable: query.error instanceof LinkUnavailable,
    refresh: query.refetch,
  };
}
